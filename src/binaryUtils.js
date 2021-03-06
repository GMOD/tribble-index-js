const { Parser } = require('@gmod/binary-parser')

/* istanbul ignore next */
function formatLongLE(fieldName) {
  return b => {
    if (b[7] || b[6] & 224) {
      throw new Error(`integer overflow reading ${fieldName}`)
    }

    const result =
      b[6] * 2 ** 48 +
      b[5] * 2 ** 40 +
      b[4] * 2 ** 32 +
      b[3] * 2 ** 24 +
      (b[2] << 16) +
      (b[1] << 8) +
      b[0]

    return result
  }
}

/**
 * Helper function for use with binary-parser to attempt to read a `long` (64-bit signed int) from the Buffer.
 * JavaScript does not quite support 64 bit integers, so this will throw an integer overflow error if it overflows.
 * @param {string} fieldName
 * @private
 */
function readLongFromArray(fieldName) {
  return [
    fieldName,
    {
      type: 'uint8',
      length: 8,
      formatter: formatLongLE(fieldName),
    },
  ]
}

/**
 * Instantiates and returns a new little-endian binary-parser
 * @private
 */
function parser() {
  return new Parser().endianess('little')
}

module.exports = { readLongFromArray, parser }
