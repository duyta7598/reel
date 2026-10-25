import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),{load}=createRequire(require.resolve('electron-updater'))('js-yaml')
const pkg=JSON.parse(await fs.readFile('package.json','utf8')),name=`Reel-Setup-${pkg.version}.exe`,file=path.join('dist',name)
const metadata=load(await fs.readFile('dist/latest.yml','utf8')),entry=metadata.files?.find(item=>item.url===name)
assert.equal(metadata.version,pkg.version,'Update version must match the application')
assert.ok(entry,'Update metadata must reference the generated installer')
assert.equal(metadata.path,name,'Update path must match the installer filename')
const hash=crypto.createHash('sha512')
for await(const chunk of createReadStream(file))hash.update(chunk)
const digest=hash.digest('base64')
assert.equal(entry.sha512,digest,'Installer checksum must match update metadata')
assert.equal(metadata.sha512,digest,'Legacy installer checksum must match update metadata')
assert.equal(entry.size,(await fs.stat(file)).size,'Installer size must match update metadata')
assert.ok((await fs.stat(file+'.blockmap')).size>0,'Installer blockmap is required')
const config=load(await fs.readFile('dist/win-unpacked/resources/app-update.yml','utf8'))
assert.equal(config.provider,'github');assert.equal(config.owner,'duyta7598');assert.equal(config.repo,'reel')
process.stdout.write('Windows installer, update metadata, blockmap and update source verified\n')
