const {JSDOM, VirtualConsole}=require('jsdom');
const path=require('node:path');
const errors=[];
const vc=new VirtualConsole(); vc.on('jsdomError',e=>errors.push(e.message));
JSDOM.fromFile(path.join(__dirname,'smoke-test.html'),{runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc}).then(dom=>{
  setTimeout(()=>{const report=dom.window.document.body.getAttribute('data-smoke');console.log(report || 'FAIL | 没有20秒报告');errors.forEach(e=>console.error(e));dom.window.close();process.exitCode=!report || report.includes('FAIL') || errors.length ? 1:0;},21500);
});
