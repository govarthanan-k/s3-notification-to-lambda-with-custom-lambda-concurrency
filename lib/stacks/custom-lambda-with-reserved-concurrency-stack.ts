import * as cdk from "aws-cdk-lib";
import { RemovalPolicy } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class CustomLambdaWithReservedConcurrencyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    new Bucket(this, "id", {
      bucketName: "gova-test-bucket-1",
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
