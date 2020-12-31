'use strict';
const axios = require('axios')
const AWS = require('aws-sdk')
const AmazonS3URI = require('amazon-s3-uri')

const REGION = process.env.REGION
AWS.config.update({region: REGION || 'us-east-1'})

const sqs = new AWS.SQS({apiVersion: '2012-11-05'})
const s3 = new AWS.S3({apiVersion: '2006-03-01'})
const stepFunctions = new AWS.StepFunctions('2016-11-23')


async function FetchData(url){
  try {
    return await axios.get(url)
  } catch (error) {
    console.error(error, error.stack)
    throw new Error(`Unable to fetch data from: ${url}`)
  }
}
function GetMediaURIs(fileUris, hostname, port){
  let uris = fileUris.map(fileUri => {
    try {
      const {region, bucket, key} = AmazonS3URI(fileUri)
      return `http://${hostname}:${port}/api/items/download/${bucket}/${key}`
    } catch (error) {
      console.log(error, error.stack)
      throw new Error(`${fileUri} is not a valid S3 URI`)
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
      console.log(error, error.stack)
      throw new Error(`${uri} is not a valid S3 URI`)
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
    console.log(error, error.stack)
    throw new Error(`Unable to download media file(s) from: ${uris}`)
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
    console.log(error, error.stack)
    throw new Error(`Unable to put object(s) in S3 bucket: ${target_bucket}`)
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
    console.error(error, error.stack)
    throw new Error(`Unable to send message(s) to: ${sqs_url}`)
  }
}

module.exports.start = async (event, context) => {
  /**
   * First Lambda function. Triggered manually.
   * @param {object} event AWS event data
   * @param {object} context AWS function's context
   * @returns {undefined}
   */
  
  const HOSTNAME = process.env.HOSTNAME
  if (HOSTNAME === undefined) {
    throw new Error(`No HOSTNAME environment variable is set.`)
  }
  const PORT = process.env.PORT
  if (PORT === undefined) {
    throw new Error(`No PORT environment variable is set.`)
  }
  const PATH = process.env.PATH
  if (PATH === undefined) {
    throw new Error(`No PATH environment variable is set.`)
  }
  const TARGET_BUCKET = process.env.TARGET_BUCKET
  if (TARGET_BUCKET === undefined) {
    throw new Error(`No TARGET_BUCKET environment variable is set.`)
  }
  const SQS_URL = process.env.SQS_URL
  if (SQS_URL === undefined) {
    throw new Error(`No SQS_URL environment variable is set.`)
  }

  try {
    let url = `http://${HOSTNAME}:${PORT}/${PATH}`
    let response = await FetchData(url)
    let items = response.data
    let fileUris = items.map(item => item.file_path)
    let uris = GetMediaURIs(fileUris, HOSTNAME, PORT)
    let mediaFiles = await GetMediaFiles(uris)
    let updatedItems = UpdateItemUris(items, TARGET_BUCKET)
    await MoveFilesToS3(mediaFiles, TARGET_BUCKET)
    await SendMessages(updatedItems, SQS_URL)
  } catch (error) {
    console.log(error, error.stack)
  }
};

async function executeStepFunctions(stateMachine, records) {
  let executionPromises = []
  records.forEach(record => {
    let item = JSON.parse(record.body)
    let event = {item: item}
    let params = {
      stateMachineArn: stateMachine.stateMachineArn,
      input: JSON.stringify(event) // string value
    }
    executionPromises.push(stepFunctions.startExecution(params).promise())
  })
  try{
    return await Promise.all(executionPromises)
  } catch(err) {
    console.log(err, err.stack)
    throw new Error('Could not start executing step functions')
  }
}
async function getStateMachines(params = {}) {
  try {
    return await stepFunctions.listStateMachines(params).promise()
  } catch (error) {
    console.log(err, err.stack)
    throw new Error('Could not get a list of state machines')
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

  let listStateMachines = await stepFunctions.listStateMachines({}).promise()
  let match = listStateMachines.stateMachines.find(sf => sf.name === stateMachineName)
  if (match === undefined) {
    throw new Error(`No state machine with name ${stateMachineName} found.`)
  }

  let executions = await executeStepFunctions(match, event.Records)
  // console.log(executions)
}

