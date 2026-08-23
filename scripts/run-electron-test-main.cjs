const { pathToFileURL } = require('node:url')
const { app } = require('electron')

const testEntry = process.env.QORTIUM_HOME_ELECTRON_TEST_ENTRY
if (!testEntry) {
  console.error('QORTIUM_HOME_ELECTRON_TEST_ENTRY is required.')
  app.exit(1)
} else {
  import(pathToFileURL(testEntry).href).then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    },
  )
}
