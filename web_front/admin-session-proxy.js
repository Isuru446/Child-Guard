// Same-origin development configuration selected by vite.config.js.
// Browser uses relative /api URLs on localhost:5174; no credentialed CORS.
export const adminSessionDevelopmentServer = Object.freeze({
  host:'localhost', port:5174, strictPort:true,
  proxy:{'/api':{target:'http://127.0.0.1:3100',changeOrigin:false}},
});
