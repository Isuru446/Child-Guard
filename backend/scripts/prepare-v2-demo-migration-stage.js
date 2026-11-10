import { prepareDemoStage,verifyDemoStage } from '../src/demo-migration-stage.js';
try{
 if(process.cwd()!=='D:\\ChildGuard-V2')throw Error();
 if(process.argv.length===3&&process.argv[2]==='--prepare')console.log(prepareDemoStage());
 else if(process.argv.length===4&&process.argv[2]==='--verify'){verifyDemoStage(process.argv[3]);console.log('Demo migration stage integrity PASSED');}
 else throw Error();
}catch{console.error('Demo migration stage refused; no database operation occurred');process.exitCode=1;}
