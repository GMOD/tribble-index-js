import fs from 'fs'
import { promisify } from 'es6-promisify'

import read from '../src'

const readFile = promisify(fs.readFile)

describe('index reader', () => {
  const testcases = [
    { file: 'phased.vcf.idx' },
    { file: 'serialization_test.bcf.idx' },
    { file: 'test1.vcf.idx' },
    {
      file: 'Tb.vcf.idx',
    },
    {
      file: '1801160099-N32519_26611_S51_56704.hard-filtered.vcf.idx',
    },
    {
      file: 'baseVariants.vcf.idx',
    },
    {
      file: 'trio.vcf.idx',
      throws: true,
    },
    {
      file: 'mangledBaseVariants.vcf.idx',
      throws: true,
    },
    {
      file: 'corruptedBaseVariants.vcf.idx',
      throws: true,
    },
  ]

  testcases.forEach(({ file, throws }) => {
    it(`can read ${file}`, async () => {
      const fn = require.resolve(`./data/${file}`)
      const buf = await readFile(fn)
      if (throws) {
        expect(() => read(buf)).toThrow()
      } else {
        const result = read(buf)
        const expectedFilename = `${fn}.expected.json`
        // fs.writeFileSync(expectedFilename, JSON.stringify(result, null, 2))
        const expected = JSON.parse(await readFile(expectedFilename, 'utf8'))
        expect(result).toEqual(expected)
      }
    })
  })
  it(`can get blocks from phased.vcf.idx, which has whitespace in one of the chr names`, async () => {
    const file = 'phased.vcf.idx'
    const fn = require.resolve(`./data/${file}`)
    const buf = await readFile(fn)
    const index = read(buf)
    expect(index.getBlocks('foo', 120, 400)).toEqual([])
    expect(index.getBlocks('20', 0, 9000000)).toHaveLength(2)
    expect(index.getBlocks('20', 0, 9000000)).toEqual([
      { length: 102, offset: 1142 },
      { length: 124, offset: 1244 },
    ])
  })
})
