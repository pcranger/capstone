import React from 'react';
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
import { CameraSurface } from '../src/camera/CameraSurface';

const mockSmall = { width:768,height:432,toEncodedImageDataAsync:jest.fn(async()=>({buffer:new Uint8Array([1,2,3]).buffer})),dispose:jest.fn() };
const mockImage = { width:1920,height:1080,resizeAsync:jest.fn(async()=>mockSmall),dispose:jest.fn() };
const mockSnapshot = jest.fn(async()=>mockImage);
const mockPhoto = { toImageAsync:jest.fn(async()=>mockImage),dispose:jest.fn() };
const mockPhotoOutput = { capturePhoto:jest.fn(async()=>mockPhoto) };
const mockFrameOutput = {};
const mockRegister = jest.fn();
const mockOutputs = jest.fn();
jest.mock('../modules/crosswise-native',()=>({__esModule:true,default:null}));
jest.mock('../src/ai/gemini',()=>({bytesToBase64:()=> 'jpeg'}));
jest.mock('../src/state/controller',()=>{
  const {Store}=require('../src/state/store');
  return {controller:{loadedModel:new Store(null),settings:new Store({scoreThreshold:.35}),debugCapture:new Store(false),
    registerCapturer:(...args:unknown[])=>mockRegister(...args),setCameraStatus:jest.fn(),setCameraGeometry:jest.fn(),cameraDiagnostic:jest.fn()}};
});
jest.mock('react-native-worklets',()=>({createSynchronizable:()=>({getBlocking:()=>false,setBlocking:jest.fn()}),scheduleOnRN:jest.fn()}));
jest.mock('react-native-vision-camera-resizer',()=>({useResizer:()=>({resizer:null,error:null})}));
jest.mock('react-native-vision-camera',()=>{
  const React=require('react');
  return {Camera:React.forwardRef((props:any,ref:any)=>{
    React.useImperativeHandle(ref,()=>({takeSnapshot:mockSnapshot}));mockOutputs(props.outputs);return null;
  }),useCameraDevice:()=>({id:'back'}),useAsyncRunner:()=>({runAsync:jest.fn()}),useFrameOutput:()=>mockFrameOutput,
  usePhotoOutput:()=>mockPhotoOutput,useCamera:(props:any)=>{mockOutputs(props.outputs);return {};},CommonResolutions:{HD_16_9:{width:720,height:1280},VGA_16_9:{width:480,height:854}}};
});

beforeEach(()=>jest.clearAllMocks());
test('visible camera captures a preview snapshot without attaching a photo stream and releases images',async()=>{
  let tree: { unmount(): void };
  act(()=>{tree=TestRenderer.create(<CameraSurface showPreview />);});
  const capture=mockRegister.mock.calls[0][0];
  await expect(capture()).resolves.toBe('jpeg');
  expect(mockOutputs).toHaveBeenLastCalledWith([mockFrameOutput]);
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
  expect(mockPhotoOutput.capturePhoto).not.toHaveBeenCalled();
  expect(mockImage.resizeAsync).toHaveBeenCalledWith(768,432);
  expect(mockSmall.dispose).toHaveBeenCalledTimes(1);
  expect(mockImage.dispose).toHaveBeenCalledTimes(1);
  act(()=>tree!.unmount());
  expect(mockRegister).toHaveBeenLastCalledWith(null);
});
test('hidden preview preserves scene capture through the photo output',async()=>{
  let tree: { unmount(): void };
  act(()=>{tree=TestRenderer.create(<CameraSurface showPreview={false} />);});
  await expect(mockRegister.mock.calls[0][0]()).resolves.toBe('jpeg');
  expect(mockOutputs).toHaveBeenLastCalledWith([mockFrameOutput,mockPhotoOutput]);
  expect(mockSnapshot).not.toHaveBeenCalled();
  expect(mockPhoto.dispose).toHaveBeenCalledTimes(1);
  act(()=>tree!.unmount());
});
