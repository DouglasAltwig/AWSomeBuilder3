'use strict';

const path = require('path')
const axios = require('axios')
const AWS = require('aws-sdk')
const iam = new AWS.IAM({apiVersion: '2010-05-08'})
const s3 = new AWS.S3({apiVersion: '2006-03-01'})
const rekognition = new AWS.Rekognition({apiVersion: '2016-06-27'})
const dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'})
const {marshall, unmarshall} = AWS.DynamoDB.Converter
const AmazonS3URI = require('amazon-s3-uri')
const { v4: uuidv4 } = require('uuid')


module.exports.startRecognition = async (event, context) => {
  console.log('StartRecognition')
  console.log('Event: ', event)

  if (typeof process.env.SUPPORTED_IMAGE_FORMATS === "undefined") {
    throw new Error('No SUPPORTED_IMAGE_FORMATS environment variable is set.')
  }
  if (typeof process.env.SUPPORTED_VIDEO_FORMATS === "undefined") {
    throw new Error('No SUPPORTED_VIDEO_FORMATS environment variable is set.')
  }

  try {
    const fileUri = event.item.file_path
    var {region, bucket, key} = AmazonS3URI(fileUri)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`${fileUri} is not a valid S3 URI`)
  }

  let ext = path.parse(key).ext
  if (process.env.SUPPORTED_IMAGE_FORMATS.includes(ext)){
    return {item: event.item, MediaType: "IMAGE"}
  } else if (process.env.SUPPORTED_VIDEO_FORMATS.includes(ext)){
    return {item: event.item, MediaType: "VIDEO"}
  } else {
    throw new Error(`Media Format not supported: ${ext}`)
  }
}
async function DetectLabels(bucket, key) {
  const params = {Image: {S3Object: {Bucket: bucket, Name: key}}}
  return await rekognition.detectLabels(params).promise()
}
module.exports.startSyncRecognition = async (event, context) => {
  console.log('StartSyncRecognition')
  console.log('Event: ', event)
  
  if (typeof process.env.MODERATION_TABLE === "undefined") {
    throw new Error('No MODERATION_TABLE environment variable is set.')
  }

  try {
    const fileUri = event.item.file_path
    var {region, bucket, key} = AmazonS3URI(fileUri)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`${fileUri} is not a valid S3 URI`)
  }
  const jobId = uuidv4()
  const fname = path.parse(key).name
  const responseKey = `${fname}.json`
  const responseBucket = bucket
  
  try {
    console.log('Rekognition DetectLabels Params: ', bucket, key)
    var labels = await DetectLabels(bucket, key)
    console.log('Rekognition DetectLabels: ', JSON.stringify(labels, null, 4))
  } catch (error) {
    console.log(error, error.stack)
    return {Status: 'FAILED', JobId: jobId, item: event.item}
  }

  try {
    await putObject(responseBucket, responseKey, JSON.stringify(labels.Labels))
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to store object.`)
  }

  try {
    await storeJobId(jobId)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to store JobId: ${jobid} in the database.`)
  }
  try {
    await UpdateJobStatus(jobId, 'SUCCEEDED', responseBucket, responseKey)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to update Job Status: ${jobId}.`)
  }
  return {
    Status: 'SUCCEEDED',
    JobId: jobId,
    item: event.item,
    Bucket: bucket, 
    Key: key,
  }
}
async function storeJobId(jobId) {
  const params = {
    TableName: process.env.MODERATION_TABLE,
    Item: marshall({id: jobId}),
    ReturnConsumedCapacity: "TOTAL", // INDEXES | TOTAL | NONE
    ReturnValues: "NONE" // NONE | ALL_OLD | UPDATED_OLD | ALL_NEW | UPDATED_NEW
  }
  return await dynamodb.putItem(params).promise()
}
module.exports.startAsyncRecognition = async event => {
  console.log('StartRecognition')
  console.log('Event: ', event)

  if (typeof process.env.MODERATION_TABLE === "undefined") {
    throw new Error('No MODERATION_TABLE environment variable is set.')
  }
  if (typeof process.env.SNS_TOPIC_ARN === "undefined") {
    throw new Error('No SNS_TOPIC_ARN environment variable is set.')
  }
  if (typeof process.env.ROLE_NAME === "undefined") {
    throw new Error('No ROLE_NAME environment variable is set.')
  }

  try {
    const fileUri = event.item.file_path
    var { region, bucket, key } = AmazonS3URI(fileUri)
  } catch (err) {
    console.log(err, err.stack)
    throw new Error(`${fileUri} is not a valid S3 uri`)
  }

  let roleObj = await iam.getRole({RoleName: process.env.ROLE_NAME}).promise()
  let params = {
    Video: {S3Object: {Bucket: bucket, Name: key}},
    NotificationChannel: {RoleArn: roleObj.Role.Arn, SNSTopicArn: process.env.SNS_TOPIC_ARN}
  }

  try {
    console.log('Rekognition StartLabelDetection: ', params)
    var response = await rekognition.startLabelDetection(params).promise()
    console.log('Rekognition StartLabelDetection Response: ', response)
  } catch (error) {
    console.log(error, error.stack);
    throw new Error("Unable to start detecting labels.")
  }
  
  await storeJobId(response.JobId)  

  return {JobId: response.JobId, item: event.item, Bucket: bucket, Key: key}
  // {"JobId": "b5ee510fb6e414631bfc068155e8d8640d031add6cc507747481174add7f6eb4"}
}
async function putObject(bucket, key, body) {
  const params = {Bucket:bucket, Key:key, Body: body}
  return await s3.putObject(params).promise()
}
async function UpdateJobStatus(jobId, status, responseBucket, responseKey){
  const params = {
    TableName: process.env.MODERATION_TABLE,
    Key: marshall({id: jobId}),
    UpdateExpression: 'SET stat = :status, responseBucket = :responseBucket, responseKey = :responseKey',
    ExpressionAttributeValues: marshall({
      ':status': status,
      ':responseBucket': responseBucket,
      ':responseKey': responseKey
    }),
    ReturnValues: "ALL_NEW"
  }
  return await dynamodb.updateItem(params).promise()
}
module.exports.updateRecognitionStatus = async event => {
  console.log('UpdateRecognitionStatus')
  console.log('Event: ', event)

  if (typeof process.env.MODERATION_TABLE === "undefined") {
    throw new Error('No MODERATION_TABLE environment variable is set.')
  }

  const fname = path.parse(event.Key).name
  const responseKey = `${fname}.json`
  const responseBucket = event.Bucket

  const maxResults = 1000
  const paginationToken = ''
  let finished = false
  let labels = []

  while (finished === false){

    let params = {
      JobId: event.JobId,
      MaxResults: maxResults,
      NextToken: paginationToken,
      SortBy: 'TIMESTAMP'
    }

    try {
      console.log('Rekognition GetLabelDetection Params: ', params)
      var response = await rekognition.getLabelDetection(params).promise()
      console.log('Rekognition GetLabelDetection Response: ', response)
    } catch (error) {
      console.log(error, error.stack)
      return {Status: "FAILED", item: event.item, JobId: event.JobId}
    }
    
    if(response.Labels){
      labels.push(...response.Labels) 
    }

    if (response.NextToken){
      paginationToken = response.NextToken
    } else {
      finished = true
    }
  }

  if (response.JobStatus === 'SUCCEEDED') {
    await putObject(responseBucket, responseKey, JSON.stringify(labels))
  }

  // Update the database so the step fuction can process thre response
  await UpdateJobStatus(event.JobId, response.JobStatus, responseBucket, responseKey)
  return {
    Status: response.JobStatus, 
    JobId: event.JobId,
    item: event.item, 
    Bucket: event.Bucket, 
    Key: event.Key
  }
}
async function GetItem(id) {
  const params = {
    TableName: process.env.MODERATION_TABLE,
    Key: marshall({id: id})
  }
  const response = await dynamodb.getItem(params).promise()
  return unmarshall(response.Item)
}
async function GetObject(bucket, key) {
  const params = {Bucket: bucket, Key: key}
  const response = await s3.getObject(params).promise()
  return response.Body.toString('utf-8')
}
module.exports.apiFailed = async event => {
  console.log('ApiFailed')
  console.log('Event: ', event)

  if (typeof process.env.MODERATION_TABLE === "undefined") {
    throw new Error('No MODERATION_TABLE environment variable is set.')
  }

  const params = {
    TableName: process.env.MODERATION_TABLE,
    Key: marshall({id: event.JobId}),
    UpdateExpression: 'SET stat = :status, MarketplaceItem = :Item',
    ExpressionAttributeValues: marshall({
      ':status': event.Status,
      ':Item': event.item
    }),
    ReturnValues: "ALL_NEW"
  }
  try {
    await dynamodb.updateItem(params).promise()
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Could not update item with Id: ${event.JobId}`)
  }
}

function search(needle, haystack, found = []) {
  Object.keys(haystack).forEach((key) => {
    if(key === needle){
      found.push(haystack[key])
      return found
    }
    if(typeof haystack[key] === 'object'){
      search(needle, haystack[key], found)
    }
  })
  return found
}
module.exports.checkForDrugs = async (event, context) => {
  console.log('CheckForDrugs')
  console.log('Event: ', event)

  if (typeof process.env.DRUGS_NAME_CONFIDENCE === "undefined") {
    throw new Error('No DRUGS_NAME_CONFIDENCE environment variable is set.')
  }

  try {
    var drugsObj = JSON.parse(process.env.DRUGS_NAME_CONFIDENCE)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while parsing the evironment variable 'DRUGS_NAME_CONFIDENCE': ${DRUGS_NAME_CONFIDENCE}`)
  }
  
  try {
    var item = await GetItem(event.JobId)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Could not get item with id: ${event.JobId}`)
  }

  try {
    var labelsAsString = await GetObject(item.responseBucket, item.responseKey)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Could not get object ${item.responseKey} from bucket ${item.responseBucket}.`)
  }
  
  try {
    var labels = JSON.parse(labelsAsString)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while parsing labels: ${labelsAsString}`)
  }

  let labelNames = search('Name', labels)
  let uniqLabelNames = [...new Set(labelNames)]
  // console.log(uniqInferenceKeywords)
  let drugsNames = Object.keys(drugsObj)
  // console.log(drugsKeywords)
  let result = drugsNames.filter(v => uniqLabelNames.includes(v))
  // console.log(result)
  return {
    JobId: event.JobId, 
    item: event.item,
    Bucket: event.Bucket, 
    Key: event.Key,
    Match: result.length > 0,
    CategoryMatch: "Drugs"
  }
}
module.exports.checkForFirearm = async (event, context) => {
  console.log('CheckForFirearm')
  console.log('Event: ', event)

  if (typeof process.env.GUNS_NAME_CONFIDENCE === "undefined") {
    throw new Error('No GUNS_NAME_CONFIDENCE environment variable is set.')
  }

  try {
    var gunsObj = JSON.parse(process.env.GUNS_NAME_CONFIDENCE)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while parsing the evironment variable 'GUNS_NAME_CONFIDENCE': ${GUNS_NAME_CONFIDENCE}`)
  }
  
  try {
    var item = await GetItem(event.JobId)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Could not get item with id: ${event.JobId}`)
  }

  try {
    var labelsAsString = await GetObject(item.responseBucket, item.responseKey)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Could not get object ${item.responseKey} from bucket ${item.responseBucket}.`)
  }
  
  try {
    var labels = JSON.parse(labelsAsString)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while parsing labels: ${labelsAsString}`)
  }
  
  let labelNames = search('Name', labels)
  let uniqLabelNames = [...new Set(labelNames)]
  // console.log(uniqInferenceKeywords)
  let gunsNames = Object.keys(gunsObj)
  // console.log(drugsKeywords)
  let result = gunsNames.filter(v => uniqLabelNames.includes(v))
  // console.log(result)
  return {
    JobId: event.JobId, 
    item: event.item, 
    Bucket: event.Bucket, 
    Key: event.Key,
    Match: result.length > 0,
    CategoryMatch: "Firearm"
  }
}
async function UpdateCategoryMatch(jobId, item, categoryMatch){
  const params = {
    TableName: process.env.MODERATION_TABLE,
    Key: marshall({id: jobId}),
    UpdateExpression: 'SET MarketplaceItem = :Item, CategoryMatch = :CategoryMatch',
    ExpressionAttributeValues: marshall({
      ':Item': item,
      ':CategoryMatch': categoryMatch
    }),
    ReturnValues: "ALL_NEW"
  }
  return await dynamodb.updateItem(params).promise()
}
module.exports.reportItem = async (event, context) => {
  console.log('ReportItem')
  console.log('Event: ', event)

  if (typeof process.env.MODERATION_TABLE === "undefined") {
    throw new Error('No MODERATION_TABLE environment variable is set.')
  }
  
  try {
    await UpdateCategoryMatch(event.JobId, event.item, event.CategoryMatch)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`An error occurred while updating item: ${event.JobId} in the database.`)
  }
}
module.exports.updateItemStatus = async (event, context) => {
  console.log('UpdateItemStatus')
  console.log('Event: ', event)
  
  if (typeof process.env.MODERATION_TABLE === "undefined") {
    throw new Error('No MODERATION_TABLE environment variable is set.')
  }
  if (typeof process.env.HOSTNAME === "undefined") {
    throw new Error('No HOSTNAME environment variable is set.')
  }
  if (typeof process.env.PORT === "undefined") {
    throw new Error('No PORT environment variable is set.')
  }

  try {
    const fileUri = event.item.file_path
    var {region, bucket, key} = AmazonS3URI(fileUri)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`${fileUri} is not a valid S3 URI`)
  }

  try {
    let url = `http://${process.env.HOSTNAME}:${process.env.PORT}/api/items/${event.item.id}`
    // let response = await axios.put(url, {status: 'approved'})
    // console.log(response.data.message)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to update item with id: ${event.item.id}`)
  }

  try {
    var item = await GetItem(event.JobId)
    console.log('Item: ', item)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to get item from database: ${even.JobId}`)
  }

  // Delete Json file.
  try {
    console.log('DeleteObject Params: ', item.responseBucket, item.responseKey)
    let response = await DeleteObject(item.responseBucket, item.responseKey)
    console.log('DeleteObject Response: ', response)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to delete object from S3 bucket: ${item.responseBucket}/${item.responseKey}`)
  }
  
  // Delete Media file.
  try {
    console.log('DeleteObject Params: ', bucket, key)
    let response = await DeleteObject(bucket, key)
    console.log('DeleteObject Response: ', response)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to delete object from S3 bucket: ${bucket}/${key}`)
  }

  try {
    console.log('DeleteItem Params: ', event.JobId)
    let response = await DeleteItem(event.JobId)
    console.log('DeleteItem Response: ', response)
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to delete item: ${event.JobId}`)
  }
}
async function DeleteItem(id) {
  let params = {
    TableName: process.env.MODERATION_TABLE, 
    Key: marshall({id: id})
  }
  return await dynamodb.deleteItem(params).promise()
}
async function DeleteObject(bucket, key) {
  let params = {Bucket: bucket, Key: key}
  return await s3.deleteObject(params).promise()
}
module.exports.streamFunction = async (event, context) => {
  console.log('StreamFunction')
  console.log('Event: ', event)

  if (typeof process.env.HOSTNAME === "undefined") {
    throw new Error('No HOSTNAME environment variable is set.')
  }
  if (typeof process.env.PORT === "undefined") {
    throw new Error('No PORT environment variable is set.')
  }

  let itemUpdatePromises = []
  let itemIds = []
  event.Records.forEach(record => {
    if (record.dynamodb.NewImage) {
      let unmarshalled = unmarshall(record.dynamodb.NewImage)
      let id = unmarshalled.id
      let params = {status: "escalated"}
      let url = `http://${process.env.HOSTNAME}:${process.env.PORT}/api/items/${id}`
      itemIds.push(id)
      itemUpdatePromises.push(axios.put(url, params))
    }
  })

  try {
    let reponses = await axios.all(itemUpdatePromises)
    responses.forEach(response => {
      console.log(response.status, response.config.url, response.data)
    })
  } catch (error) {
    console.log(error, error.stack)
    throw new Error(`Unable to update the following item ID(s): ${itemIds}`)
  }
}