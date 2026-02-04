try {
  const mod = require('@prisma/query-plan-executor/dist/index.js')
  console.log('keys:', Object.keys(mod).slice(0,40))
  console.log('has createAdapter=', !!mod.createAdapter)
} catch (e) {
  console.error('err:', e && e.message)
}
