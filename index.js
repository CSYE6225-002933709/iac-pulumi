import { ec2 } from "@pulumi/aws";
import pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const vpc = new ec2.Vpc("sai-vpc", {
    cidrBlock: "10.0.0.0/16",
    tags: {
        Name: "sai-vpc",
    },
});

const igw = new ec2.InternetGateway("sai-igw", {
    vpcId: vpc.id,
    
});

let publicSubnets = [];
let privateSubnets = [];

//var availabilityZones = ['us-east-1a', 'us-east-1b', 'us-east-1c'];

var availabilityZones = aws.getAvailabilityZones({state: "available"});

for (let i = 0; i < 3; i++) {
    publicSubnets[i] = new ec2.Subnet(`public-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${i}.0/24`,
        mapPublicIpOnLaunch: true,
        availabilityZone: availabilityZones[i],
    });

    privateSubnets[i] = new ec2.Subnet(`private-subnet-${i}`, {
        vpcId: vpc.id,
        cidrBlock: `10.0.${i+3}.0/24`,
        mapPublicIpOnLaunch: false,
        availabilityZone: availabilityZones[i],
    });
}

const publicRouteTable = new ec2.MainRouteTableAssociation("public-route-table", {
    vpcId: vpc.id,
    routeTableId: new ec2.RouteTable("public-routeTable", {
        vpcId: vpc.id,
        routes: [{
            cidrBlock: "0.0.0.0/0",
            gatewayId: igw.id,
        }],
    }).id,
});

const privateRouteTable = new ec2.MainRouteTableAssociation("private-route-table", {
    vpcId: vpc.id,
    routeTableId: new ec2.RouteTable("private-routeTable", {
        vpcId: vpc.id,
    }).id,
});

for (let i = 0; i < 3; i++) {
    new ec2.RouteTableAssociation(`public-association-${i}`, {
        subnetId: publicSubnets[i].id,
        routeTableId: publicRouteTable.routeTableId,
    });
    new ec2.RouteTableAssociation(`private-association-${i}`, {
        subnetId: privateSubnets[i].id,
        routeTableId: privateRouteTable.routeTableId,
    });
}
