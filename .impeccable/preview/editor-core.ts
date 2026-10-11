export const isTauri=()=>false;export const invoke=async(name:string)=>{throw Error('unknown command '+name)};
export const convertFileSrc=(path:string)=>'/__editor-asset?path='+encodeURIComponent(path);
