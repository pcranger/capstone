import { View,Pressable,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { controller } from '../state/controller';
import { useStore } from '../state/store';
import { Text } from './ScaledText';
import { Colors, useType } from './theme';
const options=[['showMovingVehicles','Moving','directions-car',Colors.VehicleMoving],['showStationaryVehicles','Stationary','local-parking',Colors.VehicleStationary]] as const;
/** Visual filters only; warning preferences and motion classification are independent. */
export function VehicleVisibilityControls({compact=false}:{compact?:boolean}) {
  const settings=useStore(controller.settings),type=useType();
  return <View style={{flexDirection:'row',gap:4,flexWrap:'wrap'}}>
    {options.map(([key,label,icon,color])=>{const enabled=settings.showOverlay&&settings[key];return <Pressable key={key} accessibilityRole="button"
      accessibilityLabel={`${label} vehicle boxes`} accessibilityState={{selected:enabled}}
      accessibilityHint={enabled?'Tap to hide these boxes.':'Tap to show these boxes.'}
      onPress={()=>controller.updateSettings(s=>({...s,[key]:!enabled,showOverlay:!enabled||s.showOverlay}))}
      style={{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',paddingHorizontal:8,gap:2}}>
      <View><MaterialIcons name={icon} size={23} color={enabled?color:Colors.VehicleOff} />
        {!enabled&&<View pointerEvents="none" style={styles.slash}/>}</View>
      {!compact&&<Text style={type.labelMedium}>{label}</Text>}
    </Pressable>})}
  </View>;
}
const styles=StyleSheet.create({slash:{position:'absolute',width:30,height:2,backgroundColor:'#FFFFFF',top:11,left:-3,transform:[{rotate:'-45deg'}]}});
