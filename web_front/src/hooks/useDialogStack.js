import {useCallback,useRef,useState} from 'react';

// Selection-driven map/detail popups keep every earlier layer mounted.
export default function useDialogStack(){
 const [layers,setLayers]=useState([]),sequence=useRef(0);
 const setModal=useCallback(value=>{
  if(value===null){setLayers(previous=>previous.slice(0,-1));return;}
  const layer={id:++sequence.current,value};setLayers(previous=>[...previous,layer]);
 },[]);
 return {modal:layers.at(-1)?.value??null,layers,setModal};
}
