import { ec2, rds } from "@pulumi/aws";
import * as aws from "@pulumi/aws";
import pulumi from "@pulumi/pulumi";

// Fetching values from Config file
const envConfig = new pulumi.Config("env");

const vpcName = envConfig.require("vpc-name");
const igwName = envConfig.require("igw-name");
const publicRtAssocName = envConfig.require("pub-rt-assoc");
const prvRtName = envConfig.require("prv-rt-name");
const pubRtName = envConfig.require("pub-rt-name");
const subnets = envConfig.require("subnets");
const vpcCIDR = envConfig.require("vpc-cidr");
const pubCIDR = envConfig.require("pub-cidr");
const rdsPass = envConfig.require("rds-password");

const amiName = envConfig.require("ami-name");
const userDataScript = envConfig.require("user-data-script");

var publicSubnetList = [];
var privateSubnetList = [];

const vpc = new ec2.Vpc(vpcName, {
  cidrBlock: vpcCIDR,
  instanceTenancy: "default",
  tags: {
    Name: vpcName,
  },
});

const igw = new ec2.InternetGateway(igwName, {
  vpcId: vpc.id,
});


const createInstance = async () => {
  const availabilityZones = await aws
    .getAvailabilityZones()
    .then((availabilityZones) => {
      const publicRouteTable = new ec2.MainRouteTableAssociation(
        publicRtAssocName,
        {
          vpcId: vpc.id,
          routeTableId: new ec2.RouteTable(pubRtName, {
            vpcId: vpc.id,
            routes: [
              {
                cidrBlock: pubCIDR,
                gatewayId: igw.id,
              },
            ],
          }).id,
        }
      );

      const privateRouteTable = new ec2.RouteTable(prvRtName, {
        vpcId: vpc.id,
      });

      const count = Math.min(availabilityZones.names.length, subnets);

      for (let i = 0; i < count; i++) {
        var publicSubnets = new ec2.Subnet(`publicsubnet${i}`, {
          vpcId: vpc.id,
          cidrBlock: `10.0.${i}.0/24`,
          mapPublicIpOnLaunch: true,
          availabilityZone: availabilityZones.names[i],
          tags: {
            Type: "public",
          },
        });

        publicSubnetList.push(publicSubnets);

        var privateSubnets = new ec2.Subnet(`private-subnet-${i}`, {
          vpcId: vpc.id,
          cidrBlock: `10.0.${i + parseInt(subnets)}.0/24`,
          mapPublicIpOnLaunch: false,
          availabilityZone: availabilityZones.names[i],
        });        

        privateSubnetList.push(privateSubnets);
        
        new ec2.RouteTableAssociation(`public-association-${i}`, {
          subnetId: publicSubnets.id,
          routeTableId: publicRouteTable.routeTableId,
        });

        new ec2.RouteTableAssociation(`private-association-${i}`, {
          subnetId: privateSubnets.id,
          routeTableId: privateRouteTable.id,
        });
      }
    });

  // Define AWS Security Group
  const appSecurityGroup = new ec2.SecurityGroup("appSecurityGroup", {
    description: "Application Security Group",
    vpcId: vpc.id,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        cidrBlocks: [pubCIDR],
      },
      {
        protocol: "tcp",
        fromPort: 80,
        toPort: 80,
        cidrBlocks: [pubCIDR],
      },
      {
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
        cidrBlocks: [pubCIDR],
      },
      {
        protocol: "tcp",
        fromPort: 8080,
        toPort: 8080,
        cidrBlocks: [pubCIDR],
      },
    ],
    egress: [
      {
        protocol: "-1",
        fromPort: 0,
        toPort: 0,
        cidrBlocks: [pubCIDR],
      },
    ],
  });

  let ami = pulumi.output(
    aws.ec2.getAmi({
      filters: [
        {
          name: "name",
          values: [amiName + "_*"],
        },
      ],
      mostRecent: true,
    })
  );  

  // Define AWS Security Group
  const databaseSecurityGroup = new aws.ec2.SecurityGroup(
    "databaseSecurityGroup",
    {
      description: "Database Security Group",
      vpcId: vpc.id,
      ingress: [
        {
          protocol: "tcp",
          fromPort: 3306,
          toPort: 3306,
          securityGroups: [appSecurityGroup.id],
        },
      ],
      egress: [
        {
          protocol: "-1",
          fromPort: 0,
          toPort: 0,
          cidrBlocks: [pubCIDR],
        },
      ],
    }
  );

  const mariaDbParameterGroup = new rds.ParameterGroup(
    "mariadb-parameter-group",
    {
      family: "mariadb10.6",
      parameters: [
        {
          name: "time_zone",
          value: "US/Eastern",
        },
      ],
    }
  );

  const rdsPrivateSubnetGroup = new rds.SubnetGroup("rds-private-subnet-group", {
    subnetIds: [privateSubnetList[0].id, privateSubnetList[1].id],
    tags: {
        Name: "PrivateSubnetGroup",        
    }
  });
  
  // Create an RDS instance
  const rdsInstance = new rds.Instance("csye6225", {

    engine: "mariadb",
    instanceClass: "db.t2.micro",
    multiAz: false,
    identifier: "csye6225",
    username: "csye6225",
    password: rdsPass,
    dbSubnetGroupName: rdsPrivateSubnetGroup,
    publiclyAccessible: false,
    dbName: "csye6225",
    parameterGroupName: mariaDbParameterGroup.name,
    allocatedStorage: 20,
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [databaseSecurityGroup.id],
  });

  // Create and launch an Amazon Linux EC2 instance into the public subnet.
  const instance = new ec2.Instance("instance", {
    ami: ami.id,
    keyName: "Login_Sai",
    instanceType: "t2.micro", 
    subnetId:  publicSubnetList[0].id,
    vpcId: vpc.id,
    vpcSecurityGroupIds: [appSecurityGroup.id],
    userData: userDataScript,
  }); 
};

createInstance();
