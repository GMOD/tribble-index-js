import indexParser from './parsers'

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

  getBlocks(chrName, start, end) {
    const regularizedChrName = LinearBinnedIndex.regularizeChrName(chrName)
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
}

class IntervalTreeIndex extends BaseIndex {
  constructor(parsed) {
    super(parsed)
    this.type = 'interval_tree'
  }

  static getBlocks(/* chrName, start, end */) {
    throw new Error(
      'getBlocks not yet implemented for interval tree indexes. help wanted.',
    )
  }
}

export default function read(input) {
  if (Buffer.isBuffer(input)) {
    const data = indexParser.parse(input)
    if (data.type === 1) return new LinearBinnedIndex(data)
    else if (data.type === 2) return new IntervalTreeIndex(data)
    throw new Error(`unsupported index type "${data.type}"`)
  }

  throw new Error(
    'unsupported input type, must be a Buffer containing the whole index',
  )
}
