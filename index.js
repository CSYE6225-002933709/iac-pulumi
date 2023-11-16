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
const domainName = envConfig.require("domain-name");

const amiName = envConfig.require("ami-name");

var rdsIP;

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

var appSecurityGroup;
var databaseSecurityGroup;
var loadBalancerSecurityGroup;

var ami;
var instance;

var mariaDbParameterGroup;
var rdsPrivateSubnetGroup;
var rdsInstance;
var publicRouteTable;
var privateRouteTable;
var hostname;
var iamUser;
var iamRole;
var rolePolicyAttachment;
var instanceProfile;

var launchConfiguration;
var autoScalingGroup;

var cpuScaleUpPolicy;
var cpuScaleDownPolicy;

var loadBalancer;

const createSecurityGroups = async () => {


  loadBalancerSecurityGroup = new aws.ec2.SecurityGroup("load balancer security group", {
    description: "Enable HTTP and HTTPS access",
    vpcId: vpc.id,
    ingress: [
        // allow HTTP from anywhere
        {
            protocol: "tcp",
            fromPort: 80,
            toPort: 80,
            cidrBlocks: [pubCIDR],
        },
        // allow HTTPS from anywhere
        {
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
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
    ]
  });

  appSecurityGroup = new ec2.SecurityGroup("appSecurityGroup", {
    description: "Application Security Group",
    vpcId: vpc.id,
    ingress: [
      {
        protocol: "tcp",
        fromPort: 22,
        toPort: 22,
        securityGroups: [loadBalancerSecurityGroup],
      },
      {
        protocol: "tcp",
        fromPort: 8080,
        toPort: 8080,
        securityGroups: [loadBalancerSecurityGroup],
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

  databaseSecurityGroup = new aws.ec2.SecurityGroup(
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

}

const createRouteTables = async () => {

  publicRouteTable = new ec2.MainRouteTableAssociation(
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

  privateRouteTable = new ec2.RouteTable(prvRtName, {
    vpcId: vpc.id,
  });
}

const createSubnets = async (availabilityZones) => {

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
}

const getUserData = async () => {

  return rdsInstance.endpoint.apply (endpoint => {
    
    const hostname = endpoint.split(':')[0];

    return `#!/bin/bash  
    
    # Configure CloudWatch
    sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/home/admin/cloudwatch-config.json \
    -s

    cd /home/csye6225/webapp || exit
    # Setting up the environment variables
    echo 'DB_USERNAME = "csye6225"' >> .env
    echo 'DB_PASSWORD = "A5tr0ngPa55w0rd"' >> .env
    echo 'DB_DIALECT  = "mysql"' >> .env
    echo 'DB_NAME     = "saiDB"' >> .env
    sudo echo 'DB_IPADDRESS = "${hostname}"' >> .env        
    
    sudo npm i

    sudo npm test    
    cd .. 
    sudo chown csye6225:csye6225 -R webapp    

    # Setting up the service
    sudo systemctl daemon-reload
    sudo systemctl enable csye6225
    sudo systemctl start csye6225
    sudo systemctl restart csye6225
    sudo reboot
    `
  })
} 

const createEC2Instance = async () => {

  ami = pulumi.output(
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

// Create and launch an Amazon Linux EC2 instance into the public subnet.
instance = new ec2.Instance("instance", {
  ami: ami.id,
  keyName: "Login_Sai",
  instanceType: "t2.micro",
  subnetId: publicSubnetList[0].id,
  vpcId: vpc.id,
  vpcSecurityGroupIds: [appSecurityGroup.id],
  userData: getUserData(),
  iamInstanceProfile: instanceProfile.name,
}, {dependsOn: [rdsInstance]});

}

const createParameterGroups = async () => {

  mariaDbParameterGroup = new rds.ParameterGroup(

    "mariadb-parameter-group",
    {
      family: "mariadb10.6",
      parameters: [
        {
          name: "time_zone",
          value: "US/Eastern",
        },

        {
          name: "max_connections",
          value: "100",
        }
      ],
    }
  );
}

const createSubnetGroups = async () => {

  rdsPrivateSubnetGroup = new rds.SubnetGroup(
    "rds-private-subnet-group",
    {
      subnetIds: privateSubnetList.map((subnet) => subnet.id), 
      tags: {
        Name: "PrivateSubnetGroup",
      },
    },
  );
}

const createRDSInstance = async () => {

  // Create an RDS instance
  rdsInstance = new rds.Instance("csye6225", {
    engine: "mariadb",
    instanceClass: "db.t2.micro",
    multiAz: false,
    identifier: "csye6225",
    username: "csye6225",
    password: rdsPass,
    dbSubnetGroupName: rdsPrivateSubnetGroup,
    publiclyAccessible: false,
    dbName: "saiDB",
    parameterGroupName: mariaDbParameterGroup.name,
    allocatedStorage: 20,
    skipFinalSnapshot: true,
    vpcSecurityGroupIds: [databaseSecurityGroup.id],
  }, {dependsOn: [rdsPrivateSubnetGroup, databaseSecurityGroup]});

  hostname = rdsInstance.endpoint.apply((endpoint) => {
    console.log(endpoint.toString());
    rdsIP = endpoint.split(':')[0];
  });
}

const setupSubdomain = async () => {

  let route53Zone = aws.route53.getZone({ name: domainName });

  const aRecord = new aws.route53.Record(`${domainName}-ARecord`, {
    zoneId: route53Zone.then(zone => zone.id),
    name: domainName,
    type: "A",

    aliases: [{
      name: loadBalancer.dnsName,
      zoneId: loadBalancer.zoneId,
      evaluateTargetHealth: true,
    }],
  });
}

const createCloudWatchIAMRole = async () => {
  // Create a new IAM User
  iamUser = new aws.iam.User("cloudwatch-user-1", {});

  // Create a new IAM role
  iamRole = new aws.iam.Role("cloudwatch-role", {
    assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Action: "sts:AssumeRole",
            Principal: {
                Service: "ec2.amazonaws.com"
            },
            Effect: "Allow",
        }],
    }),
  });

  // Attach a policy to the IAM role
  rolePolicyAttachment = new aws.iam.RolePolicyAttachment("cloudwatch-role-policy-attachment", {
    role: iamRole.name,
    policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
  });

  // Create an IAM instance profile and attach the role
  instanceProfile = new aws.iam.InstanceProfile("cloudwatch-instance-profile", {
    role: iamRole.name,
  });
}

const createLoadBalancer = async () => {

  ami = pulumi.output(
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

  launchConfiguration = new aws.ec2.LaunchConfiguration("launchConfiguration", {
    imageId: ami.id, // Replace with your custom AMI ID
    instanceType: "t2.micro",
    keyName: "Login_Sai",
    securityGroups: [ loadBalancerSecurityGroup.id ],
    associatePublicIpAddress: true,
    userData: getUserData(),
    iamInstanceProfile: instanceProfile.name,
  });

  autoScalingGroup = new aws.autoscaling.Group("autoScalingGroup", {
    
    vpcZoneIdentifiers: [publicSubnetList[0].id],
    launchConfiguration: launchConfiguration.id,
    desiredCapacity: 1,
    cooldown: 60,
    minSize: 1,
    maxSize: 3,
    tags: [{
        key: 'AutoScalingGroup',
        value: 'True',
        propagateAtLaunch: true
    }],
  });

  const bucket = new aws.s3.Bucket("my-access-logs-bucket");

  loadBalancer = new aws.lb.LoadBalancer("alb", {

    securityGroups: [loadBalancerSecurityGroup.id],
    loadBalancerType: "application",
    internal: false,
    subnets: [publicSubnetList[0].id, publicSubnetList[1].id],
    enableDeletionProtection: false,
    accessLogs: {
      bucket: bucket.bucket, 
      enabled: true, 
    },

    tags: {
      Environment: "production",
    },
  });

  const lb_target_group = new aws.lb.TargetGroup("lbTarget", {
    port: 8080, // the port where your application listens
    protocol: "HTTP",
    vpcId: vpc.id, // choose the VPC where your instances are running
    healthCheck: {
      protocol: "HTTP",
      path: "/healthz",
      matcher: "200",
      interval: 30,
      healthyThreshold: 10,
      unhealthyThreshold: 2 
  },
  });

  const lb_listener = new aws.lb.Listener("lbListener", {
    loadBalancerArn: loadBalancer.id,
    port: 80,
    defaultActions: [
        {
            type: "forward",
            targetGroupArn: lb_target_group.id,
        }
    ]
  });

  const autoScalGrpAtch = new aws.autoscaling.Attachment("asgAttachment", {
    autoscalingGroupName: autoScalingGroup.name,
    lbTargetGroupArn: lb_target_group.arn,
  });

}

const createScalingPolicies = async () => {

  cpuScaleUpPolicy = new aws.autoscaling.Policy("cpuScaleUpPolicy", {
    autoscalingGroupName: autoScalingGroup.name,
    adjustmentType: "ChangeInCapacity",
    scalingAdjustment: 1,
  });

  cpuScaleDownPolicy = new aws.autoscaling.Policy("cpuScaleDownPolicy", {
    autoscalingGroupName: autoScalingGroup.name,
    adjustmentType: "ChangeInCapacity",
    scalingAdjustment: -1,
  });

  // Add alarms
  const highCpuAlarm = new aws.cloudwatch.MetricAlarm("highCpuAlarm", {
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    evaluationPeriods: "2",
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: "60",
    statistic: "Average",
    threshold: "5",
    alarmDescription: "This metric triggers a scale up if the CPU usage exceeds 5%",
    dimensions: { AutoScalingGroupName: autoScalingGroup.name },
    alarmActions: [cpuScaleUpPolicy.arn]
  })

  const lowCpuAlarm = new aws.cloudwatch.MetricAlarm("lowCpuAlarm", {
    comparisonOperator: "LessThanOrEqualToThreshold",
    evaluationPeriods: "2",
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    period: "60",
    statistic: "Average",
    threshold: "3",
    alarmDescription: "This metric triggers a scale down if the CPU usage falls below 3%",
    dimensions: { AutoScalingGroupName: autoScalingGroup.name },
    alarmActions: [cpuScaleDownPolicy.arn]
  })

}


const createInstance = async () => {

  const availabilityZones = await aws
    .getAvailabilityZones()
    .then((availabilityZones) => {

      createSecurityGroups();

      createRouteTables();
      
      createSubnets(availabilityZones);          
      
      createParameterGroups();

      createSubnetGroups();
      
      createRDSInstance();

      createCloudWatchIAMRole();

      createLoadBalancer();

      createScalingPolicies();

      setupSubdomain();
    })
};

createInstance();
