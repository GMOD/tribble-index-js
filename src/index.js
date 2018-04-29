import indexParser from './parsers'

export default function read(input) {
  if (Buffer.isBuffer(input)) {
    const data = indexParser.parse(input)
    return data
  }

  throw new Error(
    'unsupported input type, must be a Buffer containing the whole index',
  )
}
