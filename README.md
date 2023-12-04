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

### Configuring Google cloud CLI

```
gcloud auth application-default login
gcloud config set project `PROJECT ID`

```

### Creating SSL record

```
sudo aws acm import-certificate --profile demo \             
  --certificate fileb://demo_dutt-sai-csye6225_online.crt \
  --certificate-chain fileb://demo_dutt-sai-csye6225_online.ca-bundle \
  --private-key fileb://csye6225.key
```