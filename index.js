import { ec2 } from "@pulumi/aws";
import * as aws from "@pulumi/aws";
import pulumi from "@pulumi/pulumi";

// Fetching values from Config file
const envConfig = new pulumi.Config("env");

const vpcName = envConfig.require("vpc-name");
const igwName = envConfig.require("igw-name");
const prvRtAssocName = envConfig.require("prv-rt-assoc");
const publicRtAssocName = envConfig.require("pub-rt-assoc");
const prvRtName = envConfig.require("prv-rt-name");
const pubRtName = envConfig.require("pub-rt-name");
const subnets = envConfig.require("subnets");
const vpcCIDR = envConfig.require("vpc-cidr");
const pubCIDR = envConfig.require("pub-cidr");

const amiName = envConfig.require("ami-name");
const amiId = envConfig.require("ami-id");

const publicSubnetIds = [];

const vpc = new ec2.Vpc(vpcName, {
  cidrBlock: vpcCIDR,
  instanceTenancy: "default",
  tags: {
    Name: vpcName,
  },
});

var subnetArray = [];

function init_subnets() {
  var subnet_base = vpcCIDR.split(".")[0] + vpcCIDR(".")[1] + ".";
  
  for (i = 1; i < parseInt(subnets); i++) {
    subnetArray.append(
      subnet_base +
        toString(parseInt(vpcCIDR.split(".")[3]) + i) +
        toString(parseInt(vpcCIDR.split(".")[4].split("/")) + 8)
    );
  }
}

const igw = new ec2.InternetGateway(igwName, {
  vpcId: vpc.id,
});

aws.getAvailabilityZones().then((availabilityZones) => {
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
    let publicSubnets = new ec2.Subnet(`public-subnet-${i}`, {
      vpcId: vpc.id,
      cidrBlock: `10.0.${i}.0/24`,
      mapPublicIpOnLaunch: true,
      availabilityZone: availabilityZones.names[i],
    });

    publicSubnetIds.push(publicSubnets.id);

    let privateSubnets = new ec2.Subnet(`private-subnet-${i}`, {
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
  ingress: [
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["0.0.0.0/0"],
    },
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
    },
    {
      protocol: "tcp",
      fromPort: 8080,
      toPort: 8080,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

let ami = pulumi.output(
  aws.ec2.getAmi({
    filters: [
      {
        name: "name",
        values: ["csye6225_*"],
      },
    ],
    mostRecent: true,
  })
);

// Create and launch an Amazon Linux EC2 instance into the public subnet.
const instance = new aws.ec2.Instance("instance", {
  ami: ami.id,
  keyName: "Assignment5",
  instanceType: "t2.micro",
  subnetId: publicSubnetIds[0],
  vpcSecurityGroupIds: [appSecurityGroup.id],
  userData: `
      #!/bin/bash
      which git
      cd /home/admin
      sudo tar xzvf project.tar.gz -C .
      sudo rm -r node_modules
      sudo npm i
      sudo mysql << EOF
      ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'SetRootPasswordHere';
      exit 
      EOF
      sudo mysql_secure_installation      
  `,
});
