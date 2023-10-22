import { ec2 } from "@pulumi/aws";
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

const amiName = envConfig.require("ami-name");

const vpc = new ec2.Vpc(vpcName, {
  cidrBlock: vpcCIDR,
  instanceTenancy: "default",
  tags: {
    Name: vpcName,
  },
});

var publicSubnetList = [];

const igw = new ec2.InternetGateway(igwName, {
  vpcId: vpc.id,
});

const createInstance = async () => {

  const availabilityZones = await aws.getAvailabilityZones().then((availabilityZones) => {

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
          "Type": "public",
        },
      });
      
      publicSubnetList.push(publicSubnets);
      
      var privateSubnets = new ec2.Subnet(`private-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${i + parseInt(subnets)}.0/24`,
        mapPublicIpOnLaunch: false,
        availabilityZone: availabilityZones.names[i],
      });
  
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
  const appSecurityGroup = new aws.ec2.SecurityGroup("appSecurityGroup", {
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
  
  
  /*const filteredSubnets = pulumi.output(ec2.getSubnetIds({
    tags: {
      Type: "public",
    },
    vpcId: vpc.id,
  }));
  
  const selectedSubnet = filteredSubnets.ids.apply(ids => ids[0]);
  
  console.log(publicSubnetList[0].id);
  */
  // Create and launch an Amazon Linux EC2 instance into the public subnet.
  const instance = new ec2.Instance("instance", {
    ami: ami.id,
    keyName: "Login_Sai",
    instanceType: "t2.micro", 
    subnetId:  publicSubnetList[0].id,
    vpcId: vpc.id,
    vpcSecurityGroupIds: [appSecurityGroup.id],
  });  
}

createInstance();