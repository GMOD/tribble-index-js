const LRU = require('lru-cache')
const LocalFile = require('./localFile')
const read = require('./tribble')

// function timeout(time) {
//   return new Promise(resolve => {
//     setTimeout(resolve, time)
//   })
// }

class TribbleIndexedFile {
  /**
   * @param {object} args
   * @param {string} [args.path]
   * @param {filehandle} [args.filehandle]
   * @param {string} [args.tribblePath]
   * @param {filehandle} [args.tribbleFilehandle]
   * @param {string} [args.metaChar] character that denotes the beginning of a header line
   * @param {object} [args.columnNumbers] object like {ref start end} defining the (1-based) columns in
   * the file. end may be set to -1 if not present. default {ref: 1, start: 2, end: -1}
   * @param {boolean} [args.oneBasedClosed] whether the indexed file uses one-based closed coordinates.
   * default false (implying zero-based half-open coordinates)
   * @param {number} [args.chunkSizeLimit] maximum number of bytes to fetch in a single `getLines` call.
   * default 2MiB
   * @param {number} [args.yieldLimit] maximum number of lines to parse without yielding.
   * this avoids having a large read prevent any other work getting done on the thread.  default 300 lines.
   * @param {function} [args.renameRefSeqs] optional function with sig `string => string` to transform
   * reference sequence names for the purpose of indexing and querying. note that the data that is returned is
   * not altered, just the names of the reference sequences that are used for querying.
   * @param {number} [args.blockCacheSize] maximum size in bytes of the block cache. default 5MB
   */
  constructor({
    path,
    filehandle,
    tribblePath,
    tribbleFilehandle,
    metaChar = '#',
    columnNumbers = { ref: 1, start: 2, end: -1 },
    oneBasedClosed = false,
    chunkSizeLimit = 2000000,
    yieldLimit = 300,
    renameRefSeqs = n => n,
    blockCacheSize = 5 * 2 ** 20,
  }) {
    if (filehandle) this.filehandle = filehandle
    else if (path) this.filehandle = new LocalFile(path)
    else throw new TypeError('must provide either filehandle or path')

    if (tribbleFilehandle) this.tribbleFilehandle = tribbleFilehandle
    else if (tribblePath) this.tribbleFilehandle = new LocalFile(tribblePath)
    else if (path) {
      this.tribbleFilehandle = new LocalFile(`${path}.idx`)
    } else {
      throw new TypeError(
        'must provide one of tribbleFilehandle or tribblePath',
      )
    }

    this.metaChar = metaChar
    this.columnNumbers = columnNumbers
    this.oneBasedClosed = oneBasedClosed
    this.chunkSizeLimit = chunkSizeLimit
    this.yieldLimit = yieldLimit
    this.renameRefSeqCallback = renameRefSeqs
    this.blockCache = LRU({
      max: Math.floor(blockCacheSize / (1 << 16)),
      length: n => n.length,
    })
  }

  async _loadIndex() {
    if (!this.index) {
      const bytes = await this.tribbleFilehandle.readFile()
      this.index = read(bytes)
    }
    this.index.renamedRefToRef = {}
    Object.keys(this.index.chromosomeEntries).forEach(ref => {
      this.index.renamedRefToRef[this.renameRefSeqCallback(ref)] = ref
    })
    return this.index
  }

  async getLines(ref, min, max, lineCallback) {
    if (ref === undefined)
      throw new TypeError('must provide a reference sequence name')
    if (!(min <= max))
      throw new TypeError(
        'invalid start and end coordinates. must be provided, and start must be less than or equal to end',
      )
    if (!lineCallback) throw new TypeError('line callback must be provided')

    if (!this.oneBasedClosed && min === max) return
    if (this.oneBasedClosed) max += 1
    const index = await this._loadIndex()
    let originalRef = this.index.renamedRefToRef[ref]
    if (!originalRef) originalRef = ref
    const blocks = index.getBlocks(originalRef, min, max)
    if (!blocks) {
      throw new Error(`Error in index fetch (${[ref, min, max].join(',')})`)
    }
    // check the chunks for any that are over the size limit.  if
    // any are, don't fetch any of them
    for (let i = 0; i < blocks.length; i += 1) {
      const size = blocks[i].length
      if (size > this.chunkSizeLimit) {
        throw new Error(
          `Too much data. Chunk size ${size.toLocaleString()} bytes exceeds chunkSizeLimit of ${this.chunkSizeLimit.toLocaleString()}.`,
        )
      }
    }
    const results = []
    for (let blockNum = 0; blockNum < blocks.length; blockNum += 1) {
      results.push(this._getLinesFromBlock(blocks[blockNum]))
    }
    const retrievedBlocks = await Promise.all(results)
    retrievedBlocks.forEach(block => {
      block.forEach(line => {
        const lineCheck = this.checkLine(ref, min, max, line)
        if (lineCheck.overlaps) lineCallback(line)
      })
    })
  }

  _getLinesFromBlock(block) {
    return this._getBlockCache(JSON.stringify(block), async () => {
      const buffer = Buffer.alloc(block.length)
      await this.filehandle.read(buffer, 0, block.length, block.offset)
      const lines = buffer.toString('utf8').split('\n')
      // remove the last line, since it will be either empty or partial
      lines.pop()
      return lines
    })
  }

  /**
   * @param {string} regionRefName
   * @param {number} regionStart region start coordinate (0-based-half-open)
   * @param {number} regionEnd region end coordinate (0-based-half-open)
   * @param {array[string]} line
   * @returns {object} like `{startCoordinate, overlaps}`. overlaps is boolean,
   * true if line is a data line that overlaps the given region
   */
  checkLine(regionRefName, regionStart, regionEnd, line) {
    // skip meta lines
    if (line.charAt(0) === this.metaChar) return { overlaps: false }

    // this code is kind of complex, but it is fairly fast.
    // basically, we want to avoid doing a split, because if the lines are really long
    // that could lead to us allocating a bunch of extra memory, which is slow

    const { ref, start, end } = this.columnNumbers
    const maxColumn = Math.max(ref, start, end)

    let currentColumnNumber = 1
    let currentColumnStart = 0
    let startCoordinate
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '\t') {
        if (currentColumnNumber === ref) {
          let refName = line.slice(currentColumnStart, i)
          refName = this.renameRefSeqCallback(regionRefName)
          if (refName !== regionRefName) return { overlaps: false }
        } else if (currentColumnNumber === start) {
          startCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          if (startCoordinate >= regionEnd) return { overlaps: false }
          if (end === -1) {
            // no end column, so assume the feature is 1 bp long
            if (startCoordinate + 1 <= regionStart) return { overlaps: false }
          }
        } else if (currentColumnNumber === end) {
          // this will never match if there is no end column
          const endCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          if (endCoordinate <= regionStart) return { overlaps: false }
        }
        currentColumnStart = i + 1
        currentColumnNumber += 1
        if (currentColumnNumber > maxColumn) break
      }
    }
    return { overlaps: true }
  }

  _getBlockCache(cacheKey, fillCallback) {
    const cachedPromise = this.blockCache.get(cacheKey)
    if (cachedPromise) return cachedPromise

    const freshPromise = fillCallback()
    this.blockCache.set(cacheKey, freshPromise)
    return freshPromise
  }

  async getMetadata() {
    const index = await this._loadIndex()
    return index.getMetadata()
  }

  /**
   * get an array of reference sequence names
   *
   * reference sequence renaming is not applied to these names.
   *
   * @returns {Promise} for an array of string sequence names
   */
  async getReferenceSequenceNames() {
    const metadata = await this.getMetadata()
    return metadata.chromosomes
  }

  /**
   * get a buffer containing the "header" region of
   * the file, which are the bytes up to the first
   * non-meta line
   *
   * @returns {Promise} for a buffer
   */
  async getHeaderBuffer() {
    const { firstDataOffset } = await this.getMetadata()
    const buffer = Buffer.alloc(firstDataOffset)
    await this.filehandle.read(buffer, 0, firstDataOffset, 0)
    return buffer
  }

  /**
   * get a string containing the "header" region of the
   * file, is the portion up to the first non-meta line
   *
   * @returns {Promise} for a string
   */
  async getHeader() {
    const bytes = await this.getHeaderBuffer()
    return bytes.toString('utf8')
  }

  /**
   * return the approximate number of data lines in the given reference sequence
   * returns -1 if the reference sequence is not found
   * @param {string} refSeq reference sequence name
   * @returns {Promise} for number of data lines present on that reference sequence
   */
  async lineCount(refSeq) {
    const index = await this._loadIndex()
    const originalRef = index.renamedRefToRef[refSeq]
    return index.lineCount(originalRef)
  }
}

module.exports = TribbleIndexedFile
