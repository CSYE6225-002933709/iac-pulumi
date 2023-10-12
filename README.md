# iac-pulumi
Assignment 4 of CSYE6225

This is the assignment 4 of Cloud computing where we will be implementing Infrastructure as Code using Pulumi. 

# Setting up demo mode 

```
pulumi stack ls
pulumi stack init demo
pulumi config set aws:region us-east-1 -s demo
```

## Instructions to run

### Running dev mode
```
export AWS_PROFILE=dev
pulumi stack select dev
pulumi up
```

### Switching to demo mode

```
export AWS_PROFILE=demo
pulumi stack select demo
pulumi up
```