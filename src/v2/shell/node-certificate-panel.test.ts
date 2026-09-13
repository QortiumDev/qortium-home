import assert from 'node:assert/strict'
import { needsCertificateConfirmation } from './NodeCertificatePanel'

// The panel appears only where a pin can matter: a non-loopback HTTPS node.
assert.equal(needsCertificateConfirmation('https://node1.qortium.app'), true)
assert.equal(needsCertificateConfirmation('  https://node.example:24891/ '), true)
assert.equal(needsCertificateConfirmation('https://127.0.0.1:24891'), false)
assert.equal(needsCertificateConfirmation('https://localhost:12391'), false)
assert.equal(needsCertificateConfirmation('https://[::1]:24891'), false)
assert.equal(needsCertificateConfirmation('http://node.example'), false)
assert.equal(needsCertificateConfirmation('node.example'), false)
assert.equal(needsCertificateConfirmation(''), false)

console.log('Node certificate panel tests passed.')
