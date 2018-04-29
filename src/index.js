import { readLongFromArray, parser } from './binaryUtils'

const linearDefaultBinWidth = 8000
const linearChromIndex = parser()
  .string('name', { zeroTerminated: true })
  .uint32('binWidth', {
    formatter: w => w || linearDefaultBinWidth,
  })
  .uint32('numBins')
  .uint32('longestFeature')
  .uint32('isOldV3Index', {
    // a nonzero largest block size indicates that this is an older V3 tribble linear index
    formatter: largestBlockSize => largestBlockSize > 0,
  })
  .uint32('numFeatures')
  .array(...readLongFromArray('startPosition'))
  .array('blocks', {
    type: parser().array(...readLongFromArray('position')),
    length: 'numBins',
  })

const linearParser = parser()
  .uint32('numChromosomes')
  .array('chromosomes', {
    type: linearChromIndex,
    length: 'numChromosomes',
  })

const treeParser = parser().uint32('numChromosomes')

const headerParser = parser()
  .string('magic', { length: 4 })
  .uint32('type', {
    formatter: typeNum =>
      [undefined, 'linear', 'intervalTree'][typeNum] || typeNum,
  })
  .uint32('version', {
    formatter: ver => {
      if (ver !== 3)
        throw new Error(
          `only version 3 Tribble indexes are supported, this index is version ${ver}`,
        )
      return ver
    },
  })
  .string('fileName', { zeroTerminated: true })
  .array(...readLongFromArray('fileSize'))
  .array(...readLongFromArray('fileTimestamp'))
  .string('fileMD5', { zeroTerminated: true })
  .int32('flags')
  .int32('numProperties')
  .array('properties', {
    type: parser()
      .string('key', { zeroTerminated: true })
      .string('val', { zeroTerminated: true }),
    length: 'numProperties',
  })

const indexParser = parser()
  .nest('header', { type: headerParser })
  .choice('data', {
    tag: 'indexType',
    choices: {
      1: linearParser,
      2: treeParser,
    },
    defaultChoice: linearParser,
  })

export default function read(input) {
  if (Buffer.isBuffer(input)) {
    const data = indexParser.parse(input)
    return data
  }

  throw new Error(
    'unsupported input type, must be a Buffer containing the whole index',
  )
}
