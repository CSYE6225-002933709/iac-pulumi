import { ec2 } from "@pulumi/aws";
import * as aws from "@pulumi/aws";
import pulumi from "@pulumi/pulumi";

// Fetching values from Config file
const envConfig = new pulumi.Config("env");

const vpcName   = envConfig.require("vpc-name");
const igwName   = envConfig.require("igw-name");
const prvRtAssocName = envConfig.require("prv-rt-assoc");
const publicRtAssocName = envConfig.require("pub-rt-assoc");
const prvRtName = envConfig.require("prv-rt-name");
const pubRtName = envConfig.require("pub-rt-name");
const subnets = envConfig.require("subnets");
const vpcCIDR = envConfig.require("vpc-cidr");
const pubCIDR = envConfig.require("pub-cidr");

const vpc = new ec2.Vpc(vpcName, {
    cidrBlock: vpcCIDR,
    instanceTenancy: "default",
    tags: {
        Name: vpcName,
    },
});

var subnetArray = []

function init_subnets () {

    var subnet_base = vpcCIDR.split('.')[0] + vpcCIDR('.')[1] + '.';

    for (i = 1; i < parseInt(subnets); i++) {
        
        subnetArray.append(subnet_base + toString(parseInt(vpcCIDR.split('.')[3]) + i) + toString(parseInt(vpcCIDR.split('.')[4].split('/')) + 8));
    }
}

const igw = new ec2.InternetGateway(igwName, {
    vpcId: vpc.id,
});

aws.getAvailabilityZones().then((availabilityZones)=> {

    const publicRouteTable = new ec2.MainRouteTableAssociation(publicRtAssocName, {
        vpcId: vpc.id,
        routeTableId: new ec2.RouteTable(pubRtName, {
            vpcId: vpc.id,
            routes: [{
                cidrBlock: pubCIDR,
                gatewayId: igw.id,
            }],
        }).id,
    });
    
    const privateRouteTable = new ec2.MainRouteTableAssociation(prvRtAssocName, {
        vpcId: vpc.id,
        routeTableId: new ec2.RouteTable(prvRtName, {
            vpcId: vpc.id,
        }).id,
    });

    const count = Math.min(availabilityZones.names.length, subnets);

    for (let i = 0; i < count; i++) {

        let publicSubnets = new ec2.Subnet(`public-subnet-${i}`, {
            vpcId: vpc.id,
            cidrBlock: `10.0.${i}.0/24`,
            mapPublicIpOnLaunch: true,
            availabilityZone: availabilityZones.names[i],            
        });
    
        let privateSubnets = new ec2.Subnet(`private-subnet-${i}`, {
            vpcId: vpc.id,
            cidrBlock: `10.0.${i+parseInt(subnets)}.0/24`,
            mapPublicIpOnLaunch: false,
            availabilityZone: availabilityZones.names[i],
        });

        new ec2.RouteTableAssociation(`public-association-${i}`, {
            subnetId: publicSubnets.id,
            routeTableId: publicRouteTable.routeTableId,
        });

        new ec2.RouteTableAssociation(`private-association-${i}`, {
            subnetId: privateSubnets.id,
            routeTableId: privateRouteTable.routeTableId,
        });
    }
})



