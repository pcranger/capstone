import React from 'react';
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
import { CameraSurface } from '../src/camera/CameraSurface';

const mockFrameOutput = {};
const mockOutputs = jest.fn();
jest.mock('../modules/crosswise-native',()=>({__esModule:true,default:null}));
jest.mock('../src/state/controller',()=>{
  const {Store}=require('../src/state/store');
  return {controller:{loadedModel:new Store(null),settings:new Store({scoreThreshold:.35}),debugCapture:new Store(false),
    setCameraStatus:jest.fn(),setCameraGeometry:jest.fn(),cameraDiagnostic:jest.fn()}};
});
jest.mock('react-native-worklets',()=>({createSynchronizable:()=>({getBlocking:()=>false,setBlocking:jest.fn()}),scheduleOnRN:jest.fn()}));
jest.mock('react-native-vision-camera-resizer',()=>({useResizer:()=>({resizer:null,error:null})}));
jest.mock('react-native-vision-camera',()=>{
  const React=require('react');
  const Camera=React.forwardRef((props:any,_ref:any)=>{mockOutputs(props.outputs);return null;});
  Camera.displayName='Camera';
  return {Camera,useCameraDevice:()=>({id:'back'}),useAsyncRunner:()=>({runAsync:jest.fn()}),useFrameOutput:()=>mockFrameOutput,
  useCamera:(props:any)=>{mockOutputs(props.outputs);return {};},CommonResolutions:{VGA_16_9:{width:480,height:854}}};
});

beforeEach(()=>jest.clearAllMocks());
test.each([true,false])('the camera attaches only the frame output (no photo stream) with preview %s',showPreview=>{
  let tree: { unmount(): void };
  act(()=>{tree=TestRenderer.create(<CameraSurface showPreview={showPreview} />);});
  expect(mockOutputs).toHaveBeenLastCalledWith([mockFrameOutput]);
  act(()=>tree!.unmount());
});
