'use strict';
const axios = require('axios');
const AWS = require('aws-sdk')
const AmazonS3URI = require('amazon-s3-uri')

const REGION = process.env.REGION
const HOSTNAME = process.env.HOSTNAME
const PORT = process.env.PORT
const PATH = process.env.PATH
const TARGET_BUCKET = process.env.TARGET_BUCKET
const SQS_URL = process.env.SQS_URL

AWS.config.update({region: REGION || 'us-east-1'})

const sqs = new AWS.SQS({apiVersion: '2012-11-05'})
const s3 = new AWS.S3({apiVersion: '2006-03-01'})
const stepFunctions = new AWS.StepFunctions('2016-11-23')


async function FetchData(url){
  try {
    return await axios.get(url)
  } catch (error) {
    let msg = `Unable to fetch data from: ${url}`
    console.error(msg)
    throw new Error(msg)
  }
  
}
function GetMediaURIs(fileUris, hostname, port){
  let uris = fileUris.map(fileUri => {
    try {
      const {region, bucket, key} = AmazonS3URI(fileUri)
      return `http://${hostname}:${port}/api/items/download/${bucket}/${key}`
    } catch (error) {
      console.warn(`${fileUri} is not a valid S3 uri`);
      throw new Error(`Could not parse the S3 uri: ${fileUri}`)
    }
  })
  return uris
}
function UpdateItemUris(items, target_bucket) {
  let clonedItems = JSON.parse(JSON.stringify(items))
  clonedItems.forEach(item => {
    try {
      const uri = item.file_path
      const {region, bucket, key} = AmazonS3URI(uri)
      item.file_path = uri.replace(bucket, target_bucket)
    } catch (error) {
      console.warn(`${uri} is not a valid S3 uri`);
      throw new Error(`Could not parse the S3 uri: ${uri}`)
    }
  })
  return clonedItems
}
async function GetMediaFiles(uris) {
  let promises = uris.map(uri => {
    return axios.get(uri, {responseType: 'arraybuffer'})
  })
  try {
    return await Promise.all(promises)  
  } catch (error) {
    let msg = `Unable to download media file(s) from: ${hostname}:${port}`
    console.error(msg)
    throw new Error(msg)
  }
}
async function MoveFilesToS3(responses, target_bucket) {
  let S3PutObjectPromises = []
  responses.forEach(response => {
    let params = {
      Body: response.data,
      Bucket: target_bucket,
      Key: response.config.url.split('/').pop()
    }
    S3PutObjectPromises.push(s3.putObject(params).promise())
  })
  try {
    return await Promise.all(S3PutObjectPromises)  
  } catch (error) {
    let msg = `Unable to put object in S3`
    console.error(msg)
    throw new Error(msg)
  }
}
async function SendMessages (items, sqs_url) {
  let messagePromises = []
  items.forEach(item => {
    let msg = {
      MessageBody: JSON.stringify(item),
      QueueUrl: sqs_url
    }
    messagePromises.push(sqs.sendMessage(msg).promise())
  })
  try {
    return await Promise.all(messagePromises)
  } catch (error) {
    let msg = `Unable to send message(s) to: ${sqs_url}`
    console.error(msg)
    throw new Error(msg)
  }
}

module.exports.start = async (event, context) => {
  /**
   * First Lambda function. Triggered manually.
   * @param {object} event AWS event data
   * @param {object} context AWS function's context
   * @returns {undefined}
   */
  
  try {
    let url = `http://${HOSTNAME}:${PORT}/${PATH}`
    let response = await FetchData(url)
    let items = response.data
    let fileUris = items.map(item => item.file_path)
    let uris = GetMediaURIs(fileUris, HOSTNAME, PORT)
    let mediaFiles = await GetMediaFiles(uris)
    let updatedItems = UpdateItemUris(items, TARGET_BUCKET)
    let etags = await MoveFilesToS3(mediaFiles, TARGET_BUCKET)
    let messageIds = await SendMessages(updatedItems, SQS_URL)
  } catch (error) {
    console.log(error)
  }
};

async function executeStepFunctions(stateMachine, records) {
  let executionPromises = []
  records.forEach(record => {
    let params = {
      stateMachineArn: stateMachine.stateMachineArn,
      input: record.body
    }
    executionPromises.push(stepFunctions.startExecution(params).promise())
  })
  try{
    return await Promise.all(executionPromises)
  } catch(err) {
    console.log('Could not start executing step functions');
    console.log(err, err.stack)
  }
}
async function getStateMachines(params = {}) {
  try {
    return await stepFunctions.listStateMachines(params).promise()
  } catch (error) {
    console.log('Could not list state machines')
    console.log(err, err.stack)
  }
}
module.exports.end = async (event, context) => {
  /**
   * Second lambda function. Triggered by the SQS.
   * @param {object} event AWS event data (this time will be the SQS's data)
   * @param {object} context AWS function's context
   * @returns {undefined}
   */
  const stateMachineName = process.env.STATE_MACHINE_NAME
  if (stateMachineName === undefined) {
    throw new Error(`No STATE_MACHINE_NAME environment variable is set.`)
  }

  // console.log('Fetching the list of available workflows');
  let listStateMachines = await stepFunctions.listStateMachines({}).promise()
  // console.log('Searching for the step function', listStateMachines)
  let match = listStateMachines.stateMachines.find(sf => sf.name === stateMachineName)
  
  if (match === undefined) {
    throw new Error(`No state machine with name ${stateMachineName} found.`)
  }
  // console.log('Start execution')
  let executions = await executeStepFunctions(match, event.Records)
  // console.log('Execution responses:');
  console.log(executions)
}

