const indexParser = require('./parsers')

class BaseIndex {
  constructor(parsed) {
    Object.assign(this, parsed)
  }

  static regularizeChrName(name) {
    return name.trim()
  }
}
class LinearBinnedIndex extends BaseIndex {
  constructor(parsed) {
    super(parsed)
    this.type = 'linear'
    this.chromosomeEntries = {}

    this.firstDataOffset = Math.min(
      ...this.chromosomes.map(c => c.startPosition),
    )

    this.chromosomes.forEach((chr, i) => {
      // convert the block positions into block start and size
      let currentPosition = chr.startPosition
      chr.blocks.forEach(block => {
        const blockPosition = block.position
        delete block.position
        block.length = blockPosition - currentPosition
        block.offset = currentPosition
        currentPosition = blockPosition
      })

      // record a mapping of chr name => index in the chromosomes array
      const regularizedName = LinearBinnedIndex.regularizeChrName(chr.name)
      let nameRecord = this.chromosomeEntries[regularizedName]
      if (!nameRecord) {
        nameRecord = []
        this.chromosomeEntries[regularizedName] = nameRecord
      }
      nameRecord.push(i)
    })
  }

  /**
   * Get an array of { offset, length } objects describing regions of the
   * indexed file containing data for the given range.
   *
   * @param {string} refName - name of the reference sequence
   * @param {integer} start - start coordinate of the range of interest
   * @param {integer} end - end coordinate of the range of interest
   */
  getBlocks(refName, start, end) {
    const regularizedChrName = LinearBinnedIndex.regularizeChrName(refName)
    if (!this.chromosomeEntries[regularizedChrName]) return []
    const blocks = []
    this.chromosomeEntries[regularizedChrName].forEach(chrIndex => {
      const chr = this.chromosomes[chrIndex]
      // contiguous blocks are adjacent in a linear index,
      // so we can just combine them into one merged block

      const adjustedPosition = Math.max(start - chr.longestFeature, 0)
      const startBinNumber = Math.floor(adjustedPosition / chr.binWidth)
      if (startBinNumber >= chr.blocks.length) return
      const endBinNumber = Math.min(
        Math.floor((end - 1) / chr.binWidth),
        chr.blocks.length - 1,
      )

      const { offset } = chr.blocks[startBinNumber]
      const length =
        chr.blocks[endBinNumber].offset +
        chr.blocks[endBinNumber].length -
        offset
      if (length === 0) return

      blocks.push({ offset, length })
    })
    return blocks
  }

  /**
   * Returns an object like { fileMD5 fileName fileSize fileTimestamp
   * firstDataOffset flags magic properties type version chromosomes}
   */
  getMetadata() {
    return {
      fileMD5: this.fileMD5,
      fileName: this.fileName,
      fileSize: this.fileSize,
      fileTimestamp: this.fileTimestamp,
      firstDataOffset: this.firstDataOffset,
      flags: this.flags,
      magic: this.magic,
      properties: this.properties,
      type: this.type,
      version: this.version,
      chromosomes: Object.keys(this.chromosomeEntries),
    }
  }

  /**
   * Return true if the given reference sequence is present in the index,
   * false otherwise
   * @param {string} refName
   * @returns {boolean}
   */
  hasRefSeq(refName) {
    const regularizedChrName = LinearBinnedIndex.regularizeChrName(refName)
    return !!this.chromosomeEntries[regularizedChrName]
  }

  async lineCount(refName) {
    let lc = 0
    const entries = this.chromosomeEntries[refName]
    if (!entries) return -1
    entries.forEach(entry => {
      lc += this.chromosomes[entry].numFeatures
    })
    return lc
  }
}

class IntervalTreeIndex extends BaseIndex {
  constructor(parsed) {
    super(parsed)
    this.type = 'interval_tree'
  }

  getBlocks(/* chrName, start, end */) {
    this.hello = 1 // deleteme
    throw new Error(
      'getBlocks not yet implemented for interval tree indexes. help wanted.',
    )
  }

  hasRefSeq(/* refName */) {
    this.hello = 1 // deleteme
    throw new Error(
      'hasRefSeq not yet implemented for interval tree indexes. help wanted.',
    )
  }
}

/**
 * Parse the index from the given Buffer object. The buffer must contain
 * the entire index.
 *
 * @param {Buffer} input
 * @returns {LinearIndex|IntervalTreeIndex} an index object supporting the `getBlocks` method
 */
function read(input) {
  if (Buffer.isBuffer(input)) {
    const data = indexParser.parse(input).result
    if (data.type === 1) return new LinearBinnedIndex(data)
    if (data.type === 2) return new IntervalTreeIndex(data)
    throw new Error(`unsupported index type "${data.type}"`)
  }

  throw new Error(
    'unsupported input type, must be a Buffer containing the whole index',
  )
}

module.exports = read
