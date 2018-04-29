import indexParser from './parsers'

export default function read(input) {
  if (Buffer.isBuffer(input)) {
    const data = indexParser.parse(input)
    data.data.chromosomes.forEach(chr => {
      let currentPosition = chr.startPosition
      chr.blocks.forEach(block => {
        const blockPosition = block.position
        delete block.position
        block.size = blockPosition - currentPosition
        block.start = currentPosition
        currentPosition = blockPosition
      })
    })
    return data
  }

  throw new Error(
    'unsupported input type, must be a Buffer containing the whole index',
  )
}
