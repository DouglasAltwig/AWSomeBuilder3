aws cloudformation describe-stacks
aws cloudformation wait stack-create-complete --stack-name OnPremises
aws cloudformation wait stack-update-complete --stack-name OnPremises

aws cloudformation create-stack --stack-name OnPremises --template-body file://vpc-2azs.yaml
aws cloudformation update-stack --stack-name OnPremises --template-body file://vpc-2azs.yaml

aws cloudformation create-stack --stack-name OnPremisesCSG --template-body file://client-sg.yaml --parameters ParameterKey=ParentVPCStack,ParameterValue=OnPremises

aws cloudformation create-stack --stack-name OnPremisesRDS --template-body file://rds-mysql.yaml --parameters ParameterKey=ParentVPCStack,ParameterValue=OnPremises ParameterKey=ParentClientStack,ParameterValue=OnPremisesCSG

aws cloudformation create-stack --stack-name OnPremisesEC2 --template-body file://ec2-public.yaml --parameters ParameterKey=ParentVPCStack,ParameterValue=OnPremises ParameterKey=ParentClientStack1,ParameterValue=OnPremisesCSG --capabilities CAPABILITY_IAM

aws cloudformation update-stack --stack-name OnPremisesEC2 --template-body file://ec2-public.yaml --parameters ParameterKey=ParentVPCStack,ParameterValue=OnPremises ParameterKey=ParentClientStack1,ParameterValue=OnPremisesCSG --capabilities CAPABILITY_IAM

aws cloudformation create-stack --stack-name OnPremisesFS --template-body file://s3-gateway.yaml --parameters ParameterKey=ParentVPCStack,ParameterValue=OnPremises

aws cloudformation create-stack --stack-name OnPremisesFSstorage --template-body file://s3-bucket.yaml --parameters ParameterKey=ParentS3GatewayStack,ParameterValue=OnPremisesFS
