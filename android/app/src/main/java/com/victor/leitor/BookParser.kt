package com.victor.leitor

import android.graphics.Bitmap
import com.tom_roush.pdfbox.contentstream.PDFStreamEngine
import com.tom_roush.pdfbox.contentstream.operator.Operator
import com.tom_roush.pdfbox.contentstream.operator.state.Concatenate
import com.tom_roush.pdfbox.contentstream.operator.state.Restore
import com.tom_roush.pdfbox.contentstream.operator.state.Save
import com.tom_roush.pdfbox.contentstream.operator.state.SetGraphicsStateParameters
import com.tom_roush.pdfbox.contentstream.operator.state.SetMatrix
import com.tom_roush.pdfbox.cos.COSBase
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceGray
import com.tom_roush.pdfbox.pdmodel.graphics.color.PDDeviceRGB
import com.tom_roush.pdfbox.pdmodel.graphics.form.PDFormXObject
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.text.PDFTextStripper
import com.tom_roush.pdfbox.text.TextPosition
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.text.BreakIterator
import java.util.Collections
import java.util.IdentityHashMap
import java.util.zip.ZipInputStream

enum class BlockType { HEADING, PARAGRAPH, QUOTE, POEM, LIST_ITEM, IMAGE }

data class Span(val start: Int, val end: Int, val bold: Boolean, val italic: Boolean)

/** A link from [start, end) of a block's text to block [target] of the same book (contents pages, footnotes). */
data class Link(val start: Int, val end: Int, val target: Int)

/** A text block; IMAGE blocks carry the image file name in [image] and its alt text in [text]. */
data class Block(
    val type: BlockType,
    val text: String,
    val spans: List<Span> = emptyList(),
    val image: String? = null,
    val links: List<Link> = emptyList(),
)

data class TocEntry(val title: String, val block: Int)

data class ParsedBook(
    val title: String,
    val fileType: String,
    val blocks: List<Block>,
    val images: Map<String, ByteArray> = emptyMap(),
    val cover: ByteArray? = null,
    val toc: List<TocEntry> = emptyList(),
)

object BookParser {
    private const val MAX_BLOCK = 1500
    private const val HARD_MAX_BLOCK = 3500
    private val IMAGE_EXT = Regex("\\.(jpe?g|png|gif|webp|bmp)$", RegexOption.IGNORE_CASE)

    fun parse(bytes: ByteArray, fileName: String, ocr: ((page: Int) -> String?)? = null): ParsedBook {
        val fallback = fileName.substringBeforeLast('.').ifBlank { fileName }
        val head = String(bytes, 0, minOf(bytes.size, 1024), Charsets.ISO_8859_1)
        val book = when {
            head.startsWith("%PDF") -> pdf(bytes, fallback, ocr)
            head.startsWith("PK") -> {
                val files = unzip(bytes)
                if ("META-INF/container.xml" in files) epub(files, fallback)
                else files.entries.firstOrNull { it.key.endsWith(".fb2", ignoreCase = true) }?.let { fb2(it.value, fallback) }
                    ?: throw IllegalArgumentException("zip sem EPUB/FB2: $fileName")
            }
            "<FictionBook" in head -> fb2(bytes, fallback)
            fileName.endsWith(".txt", ignoreCase = true) -> ParsedBook(fallback, "txt", txt(decodeText(bytes)))
            else -> throw IllegalArgumentException("formato não suportado: $fileName")
        }
        // splitting long blocks shifts indices, so the table of contents is remapped through the same split
        val blocks = ArrayList<Block>()
        val newIndex = IntArray(book.blocks.size)
        book.blocks.forEachIndexed { i, b ->
            newIndex[i] = blocks.size
            blocks += splitLong(b)
        }
        fun moved(block: Int) = newIndex.getOrElse(block) { blocks.lastIndex }
        val linked = blocks.map { b -> if (b.links.isEmpty()) b else b.copy(links = b.links.map { it.copy(target = moved(it.target)) }) }
        return book.copy(blocks = linked, toc = book.toc.map { it.copy(block = moved(it.block)) })
    }

    fun tocToJson(toc: List<TocEntry>): String = JSONArray().apply { toc.forEach { put(JSONObject().put("t", it.title).put("b", it.block)) } }.toString()

    fun tocFromJson(json: String): List<TocEntry> = JSONArray(json).let { a ->
        List(a.length()) { i -> a.getJSONObject(i).let { TocEntry(it.getString("t"), it.getInt("b")) } }
    }

    fun toJson(blocks: List<Block>): String = JSONArray().apply {
        blocks.forEach { b ->
            put(JSONObject().put("t", b.type.name).put("x", b.text).apply {
                if (b.spans.isNotEmpty()) {
                    put("s", JSONArray().apply { b.spans.forEach { put(JSONArray(listOf(it.start, it.end, (if (it.bold) 1 else 0) or (if (it.italic) 2 else 0)))) } })
                }
                if (b.image != null) put("i", b.image)
                if (b.links.isNotEmpty()) put("l", JSONArray().apply { b.links.forEach { put(JSONArray(listOf(it.start, it.end, it.target))) } })
            })
        }
    }.toString()

    fun fromJson(json: String): List<Block> = JSONArray(json).let { a ->
        List(a.length()) { i ->
            val o = a.getJSONObject(i)
            val spans = o.optJSONArray("s")?.let { s ->
                List(s.length()) { j -> s.getJSONArray(j).let { Span(it.getInt(0), it.getInt(1), it.getInt(2) and 1 != 0, it.getInt(2) and 2 != 0) } }
            }.orEmpty()
            val links = o.optJSONArray("l")?.let { l -> List(l.length()) { j -> l.getJSONArray(j).let { Link(it.getInt(0), it.getInt(1), it.getInt(2)) } } }.orEmpty()
            Block(BlockType.valueOf(o.getString("t")), o.getString("x"), spans, o.optString("i").ifEmpty { null }, links)
        }
    }

    private fun unzip(bytes: ByteArray): Map<String, ByteArray> = buildMap {
        ZipInputStream(bytes.inputStream()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (!e.isDirectory) put(e.name, z.readBytes())
            }
        }
    }

    private fun epub(files: Map<String, ByteArray>, fallback: String): ParsedBook {
        val container = xmlText(files.getValue("META-INF/container.xml"))
        val opfPath = Regex("<(?:\\w+:)?rootfile\\b[^>]*>").find(container)?.let { attr(it.value, "full-path") }
            ?: error("EPUB sem OPF")
        val opf = xmlText(files[opfPath] ?: error("OPF ausente: $opfPath"))
        val items = Regex("<(?:\\w+:)?item\\b[^>]*>").findAll(opf).map { it.value }.toList()
        val manifest = items.associate { attr(it, "id") to attr(it, "href") }
        val opfDir = opfPath.substringBeforeLast('/', "")
        val images = ImageStore()
        val blocks = ArrayList<Block>()
        val anchors = HashMap<String, Int>() // "file" and "file#id" -> block
        val links = ArrayList<Pair<RawLink, String>>() // with the target resolved to "file" or "file#id"
        for (m in Regex("<(?:\\w+:)?itemref\\b[^>]*>").findAll(opf)) {
            val href = manifest[attr(m.value, "idref")] ?: continue
            val chapter = resolve(opfDir, href)
            val html = files[chapter]?.let(::xmlText) ?: continue
            val chapterDir = chapter.substringBeforeLast('/', "")
            val base = blocks.size
            val parsed = blocks(html, HTML) { tag ->
                val src = attr(tag, "src") ?: attr(tag, "href") ?: return@blocks null
                val path = resolve(chapterDir, src)
                files[path]?.let { images.add(path, it) }
            }
            anchors[chapter] = base
            parsed.anchors.forEach { (id, i) -> anchors["$chapter#$id"] = base + i }
            parsed.links.forEach { l ->
                val file = if (l.href.startsWith("#")) chapter else resolve(chapterDir, l.href)
                links += RawLink(base + l.block, l.start, l.end, l.href) to anchorKey(file, l.href)
            }
            blocks += parsed.blocks
        }
        fun target(key: String) = (anchors[key] ?: anchors[key.substringBefore('#')])?.coerceAtMost(blocks.lastIndex)
        links.groupBy { it.first.block }.forEach { (i, group) ->
            val inBlock = group.mapNotNull { (l, key) -> target(key)?.let { Link(l.start, minOf(l.end, blocks[i].text.length), it) } }
            blocks[i] = blocks[i].copy(links = inBlock)
        }
        val toc = epubToc(files, items, opfDir, ::target)
        val title = Regex("<dc:title[^>]*>(.*?)</dc:title>", RegexOption.DOT_MATCHES_ALL).find(opf)
            ?.groupValues?.get(1)?.let { decode(it.replace(TAG, "")) }
        // EPUB 3 marks the cover with properties="cover-image", EPUB 2 with <meta name="cover" content="id">
        val coverId = Regex("<(?:\\w+:)?meta\\b[^>]*>").findAll(opf).map { it.value }.firstOrNull { attr(it, "name") == "cover" }?.let { attr(it, "content") }
        val coverHref = items.firstOrNull { attr(it, "properties")?.split(' ')?.contains("cover-image") == true }?.let { attr(it, "href") }
            ?: manifest[coverId]
        val cover = coverHref?.let { files[resolve(opfDir, it)] } ?: images.bytes.values.firstOrNull()
        return ParsedBook(title?.ifBlank { null } ?: fallback, "epub", blocks, images.bytes, cover, toc)
    }

    private fun epubToc(files: Map<String, ByteArray>, items: List<String>, opfDir: String, target: (String) -> Int?): List<TocEntry> {
        fun entry(title: String, dir: String, href: String) =
            target(anchorKey(resolve(dir, href), href))?.let { TocEntry(decode(title.replace(TAG, " ")), it) }
        val nav = items.firstOrNull { attr(it, "properties")?.split(' ')?.contains("nav") == true }?.let { attr(it, "href") }
        if (nav != null) {
            val path = resolve(opfDir, nav)
            val doc = files[path]?.let(::xmlText).orEmpty()
            val section = Regex("<(?:\\w+:)?nav\\b[^>]*toc[^>]*>(.*?)</(?:\\w+:)?nav>", RegexOption.DOT_MATCHES_ALL).find(doc)?.groupValues?.get(1) ?: doc
            val dir = path.substringBeforeLast('/', "")
            val entries = Regex("<a\\b([^>]*)>(.*?)</a>", RegexOption.DOT_MATCHES_ALL).findAll(section)
                .mapNotNull { m -> attr(" " + m.groupValues[1], "href")?.let { entry(m.groupValues[2], dir, it) } }.toList()
            if (entries.isNotEmpty()) return entries
        }
        val ncx = items.firstOrNull { attr(it, "media-type") == "application/x-dtbncx+xml" }?.let { attr(it, "href") } ?: return emptyList()
        val path = resolve(opfDir, ncx)
        val dir = path.substringBeforeLast('/', "")
        return Regex("<navLabel>\\s*<text>(.*?)</text>\\s*</navLabel>\\s*<content\\b([^>]*)>", RegexOption.DOT_MATCHES_ALL)
            .findAll(files[path]?.let(::xmlText).orEmpty())
            .mapNotNull { m -> attr(" " + m.groupValues[2], "src")?.let { entry(m.groupValues[1], dir, it) } }.toList()
    }

    private fun fb2(bytes: ByteArray, fallback: String): ParsedBook {
        val xml = xmlText(bytes)
        val title = Regex("<book-title>(.*?)</book-title>", RegexOption.DOT_MATCHES_ALL).find(xml)?.groupValues?.get(1)?.let(::decode)
        val binaries = Regex("<binary\\b([^>]*)>(.*?)</binary>", RegexOption.DOT_MATCHES_ALL).findAll(xml)
            .mapNotNull { m -> attr(m.groupValues[1], "id")?.let { it to m.groupValues[2] } }.toMap()
        val images = ImageStore()
        val parsed = blocks(xml, FB2) { tag ->
            val id = attr(tag, "href")?.removePrefix("#") ?: return@blocks null
            binaries[id]?.let { images.add(id, base64(it)) }
        }
        val blocks = parsed.blocks.toMutableList()
        parsed.links.groupBy { it.block }.forEach { (i, group) ->
            val inBlock = group.mapNotNull { l -> parsed.anchors[l.href.removePrefix("#")]?.let { Link(l.start, minOf(l.end, blocks[i].text.length), it.coerceAtMost(blocks.lastIndex)) } }
            blocks[i] = blocks[i].copy(links = inBlock)
        }
        val coverId = Regex("<coverpage>.*?</coverpage>", RegexOption.DOT_MATCHES_ALL).find(xml)?.value
            ?.let { Regex("<(?:\\w+:)?image\\b[^>]*>").find(it)?.value }?.let { attr(it, "href")?.removePrefix("#") }
        val cover = coverId?.let { binaries[it] }?.let(::base64)
        return ParsedBook(title?.ifBlank { null } ?: fallback, "fb2", blocks, images.bytes, cover)
    }

    /** Paragraphs and images are ordered by their position on the page, so a figure lands where it was printed. */
    private fun pdf(bytes: ByteArray, fallback: String, ocr: ((Int) -> String?)?): ParsedBook = PDDocument.load(bytes).use { doc ->
        val text = PageText()
        val images = ImageStore()
        val seen = Collections.newSetFromMap(IdentityHashMap<Any, Boolean>())
        val blocks = ArrayList<Block>()
        val pageStart = IntArray(doc.numberOfPages)
        // OCR only scanned books: a normal PDF's image-only pages (cover, full-page figures) must stay images
        val probePages = minOf(5, doc.numberOfPages)
        val scanned = ocr != null && probePages > 0 &&
            PDFTextStripper().apply { setStartPage(1); setEndPage(probePages) }.getText(doc).trim().length < 30 * probePages
        doc.pages.forEachIndexed { i, page ->
            pageStart[i] = blocks.size
            text.paragraphs.clear()
            text.setStartPage(i + 1)
            text.setEndPage(i + 1)
            text.getText(doc)
            val placed = ArrayList<Pair<Float, Block>>()
            text.paragraphs.forEach { (y, t) -> placed += y to Block(classify(t), t) }
            if (scanned && placed.sumOf { it.second.text.length } < 20) {
                ocr?.invoke(i)?.let { txt(it) }?.takeIf { it.isNotEmpty() }?.let { ocrBlocks ->
                    blocks += ocrBlocks
                    return@forEachIndexed
                }
            }
            val located = PageImages(page.cropBox.height).also { runCatching { it.processPage(page) } }.found
            for ((y, img) in located) {
                // first use only: logos and ornaments repeated on every page appear once; tiny images are skipped
                if (!seen.add(img.cosObject) || img.width < 64 || img.height < 64) continue
                val data = runCatching { pdfImageBytes(img) }.getOrNull() ?: continue
                images.add("pdf-${seen.size}", data)?.let { placed += y to Block(BlockType.IMAGE, "", image = it) }
            }
            blocks += placed.sortedBy { it.first }.map { it.second }
        }
        val title = doc.documentInformation?.title?.takeIf { it.isNotBlank() } ?: fallback
        ParsedBook(title, "pdf", blocks, images.bytes, toc = pdfOutline(doc, pageStart))
    }

    private class PageText : PDFTextStripper() {
        val paragraphs = ArrayList<Pair<Float, String>>()
        private val sb = StringBuilder()
        private var y = 0f

        init {
            setSortByPosition(true)
        }

        override fun writeString(text: String, textPositions: List<TextPosition>) {
            if (sb.isEmpty() && textPositions.isNotEmpty()) y = textPositions[0].yDirAdj
            sb.append(text)
        }

        override fun writeWordSeparator() {
            sb.append(' ')
        }

        override fun writeLineSeparator() {
            sb.append('\n')
        }

        override fun writeParagraphEnd() = flush()

        override fun writePageEnd() = flush()

        private fun flush() {
            val t = sb.toString().replace(HYPHEN_BREAK, "").replace(WS, " ").trim()
            if (t.isNotEmpty()) paragraphs += y to t
            sb.setLength(0)
        }
    }

    // PDF user space grows upward: an image's top is pageHeight - (y + height).
    private class PageImages(private val pageHeight: Float) : PDFStreamEngine() {
        val found = ArrayList<Pair<Float, PDImageXObject>>()

        init {
            addOperator(Concatenate())
            addOperator(Save())
            addOperator(Restore())
            addOperator(SetGraphicsStateParameters())
            addOperator(SetMatrix())
        }

        override fun processOperator(operator: Operator, operands: List<COSBase>) {
            if (operator.name != "Do") return super.processOperator(operator, operands)
            val name = operands.firstOrNull() as? COSName ?: return
            when (val x = runCatching { resources.getXObject(name) }.getOrNull()) {
                is PDImageXObject -> {
                    val m = graphicsState.currentTransformationMatrix
                    found += (pageHeight - (m.translateY + m.scaleY)) to x
                }
                is PDFormXObject -> showForm(x)
            }
        }
    }

    private fun pdfOutline(doc: PDDocument, pageStart: IntArray): List<TocEntry> {
        val out = ArrayList<TocEntry>()
        fun walk(items: Iterable<PDOutlineItem>, depth: Int) {
            for (item in items) {
                val page = runCatching { item.findDestinationPage(doc) }.getOrNull()
                val index = page?.let { doc.pages.indexOf(it) } ?: -1
                if (index in pageStart.indices && !item.title.isNullOrBlank()) out += TocEntry(item.title.trim(), pageStart[index])
                if (depth < 1) walk(item.children(), depth + 1)
            }
        }
        doc.documentCatalog.documentOutline?.let { walk(it.children(), 0) }
        return out
    }

    /** Plain RGB/gray JPEGs are copied byte-for-byte; anything else (CMYK, masks, other codecs) is decoded and saved as PNG. */
    private fun pdfImageBytes(img: PDImageXObject): ByteArray {
        val cs = img.colorSpace
        if (img.suffix == "jpg" && img.softMask == null && (cs is PDDeviceRGB || cs is PDDeviceGray)) {
            return img.createInputStream(listOf(COSName.DCT_DECODE.name)).use { it.readBytes() }
        }
        return ByteArrayOutputStream().also { img.image.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }

    /** Plain text: blank lines separate paragraphs, unless the file barely has any (then one line = one paragraph). */
    fun txt(s: String): List<Block> {
        val t = s.removePrefix("\uFEFF").replace("\r\n", "\n")
        val blank = Regex("\n[ \t]*\n")
        val lines = t.count { it == '\n' } + 1
        val paras = if (blank.findAll(t).count() * 20 >= lines) t.split(blank) else t.split('\n')
        return paras.map { it.replace(WS, " ").trim() }.filter { it.isNotEmpty() }.map { Block(classify(it), it) }
    }

    // Formats without markup (TXT, PDF) still announce chapters in words; those short lines become headings for the table of contents.
    private val CHAPTER = Regex(
        "^(chapter|cap[ií]tulo|cap\\.|part|parte|livro|book|section|se[çc][ãa]o)\\s+[\\w.]+\\b.*" +
            "|^(prologue|pr[óo]logo|epilogue|ep[íi]logo|introduction|introdu[çc][ãa]o|preface|pref[áa]cio|foreword|afterword|posf[áa]cio)\\b.*",
        RegexOption.IGNORE_CASE,
    )

    private fun classify(text: String) = if (text.length <= 80 && CHAPTER.matches(text)) BlockType.HEADING else BlockType.PARAGRAPH

    fun html(src: String): List<Block> = blocks(src, HTML) { null }.blocks

    private class ImageStore {
        val bytes = LinkedHashMap<String, ByteArray>()
        private val names = HashMap<String, String>()

        fun add(key: String, data: ByteArray): String? {
            names[key]?.let { return it }
            val ext = IMAGE_EXT.find(key)?.value?.lowercase() ?: sniffExt(data) ?: return null // SVG and unknown formats are skipped
            return "${names.size}$ext".also { names[key] = it; bytes[it] = data }
        }

        private fun sniffExt(d: ByteArray) = when {
            d.size > 3 && d[0] == 0xFF.toByte() && d[1] == 0xD8.toByte() -> ".jpg"
            d.size > 3 && d[0] == 0x89.toByte() && d[1] == 'P'.code.toByte() -> ".png"
            d.size > 3 && d[0] == 'G'.code.toByte() && d[1] == 'I'.code.toByte() -> ".gif"
            else -> null
        }
    }

    private class Markup(
        val ctx: Map<String, BlockType>, // decides a block's type, first match wins
        val breaks: Set<String>, // ends the current block
        val skip: Set<String>, // content ignored entirely
        val bold: Set<String>,
        val italic: Set<String>,
        val images: Set<String>,
    )

    private val HTML = Markup(
        ctx = linkedMapOf(
            "h1" to BlockType.HEADING, "h2" to BlockType.HEADING, "h3" to BlockType.HEADING,
            "h4" to BlockType.HEADING, "h5" to BlockType.HEADING, "h6" to BlockType.HEADING,
            "blockquote" to BlockType.QUOTE, "li" to BlockType.LIST_ITEM,
        ),
        breaks = setOf(
            "p", "div", "section", "article", "pre", "td", "th", "tr", "dd", "dt", "figcaption",
            "ul", "ol", "table", "hr", "br", "body", "header", "footer", "aside", "nav",
        ),
        skip = setOf("head", "script", "style", "math"),
        bold = setOf("b", "strong"),
        italic = setOf("i", "em"),
        images = setOf("img", "image"),
    )

    private val FB2 = Markup(
        ctx = linkedMapOf(
            "title" to BlockType.HEADING, "subtitle" to BlockType.HEADING,
            "poem" to BlockType.POEM, "cite" to BlockType.QUOTE, "epigraph" to BlockType.QUOTE,
        ),
        breaks = setOf("p", "v", "stanza", "section", "text-author", "empty-line", "body"),
        skip = setOf("description", "binary"),
        bold = setOf("strong"),
        italic = setOf("emphasis"),
        images = setOf("image"),
    )

    private val TAG = Regex("<(/?)([A-Za-z][\\w:.-]*)[^>]*?(/?)>|<!--[\\s\\S]*?-->|<![^>]*>|<\\?[\\s\\S]*?\\?>")
    private val WS = Regex("\\s+")
    private val HYPHEN_BREAK = Regex("-\\r?\\n(?=\\p{Ll})")
    private val ENTITY = Regex("&(#[xX][0-9a-fA-F]+|#\\d+|[A-Za-z]+\\d*);")
    private val NAMED = mapOf(
        "amp" to "&", "lt" to "<", "gt" to ">", "quot" to "\"", "apos" to "'", "nbsp" to " ", "shy" to "",
        "mdash" to "—", "ndash" to "–", "hellip" to "…", "laquo" to "«", "raquo" to "»",
        "lsquo" to "‘", "rsquo" to "’", "ldquo" to "“", "rdquo" to "”", "bdquo" to "„", "copy" to "©",
    )

    private class RawLink(val block: Int, val start: Int, val end: Int, val href: String)

    /** [anchors] maps element ids to the block they open; link hrefs are resolved by the caller, which knows the files. */
    private class Parsed(val blocks: List<Block>, val anchors: Map<String, Int>, val links: List<RawLink>)

    private val EXTERNAL = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")

    private fun anchorKey(file: String, href: String) = href.substringAfter('#', "").let { if (it.isEmpty()) file else "$file#$it" }

    private fun blocks(src: String, m: Markup, image: (tag: String) -> String?): Parsed {
        val out = ArrayList<Block>()
        val anchors = HashMap<String, Int>()
        val links = ArrayList<RawLink>()
        var linkHref: String? = null
        var linkStart = 0
        val sb = StringBuilder()
        val spans = ArrayList<Span>()
        val depth = HashMap<String, Int>()
        var skipping = 0
        var bold = 0
        var italic = 0
        var pos = 0

        // Appends text with entities decoded and whitespace collapsed, so span offsets match the final string.
        fun text(raw: String) {
            val start = sb.length
            for (c in decodeEntities(raw)) {
                if (c.isWhitespace()) {
                    if (sb.isNotEmpty() && sb.last() != ' ') sb.append(' ')
                } else sb.append(c)
            }
            if ((bold > 0 || italic > 0) && sb.length > start) {
                val last = spans.lastOrNull()
                if (last != null && last.end == start && last.bold == bold > 0 && last.italic == italic > 0) spans[spans.lastIndex] = last.copy(end = sb.length)
                else spans += Span(start, sb.length, bold > 0, italic > 0)
            }
        }

        fun flush() {
            if (sb.endsWith(' ')) sb.setLength(sb.length - 1)
            if (sb.isNotEmpty()) {
                val type = m.ctx.entries.firstOrNull { (depth[it.key] ?: 0) > 0 }?.value ?: BlockType.PARAGRAPH
                out += Block(type, sb.toString(), spans.mapNotNull { s -> s.copy(end = minOf(s.end, sb.length)).takeIf { it.end > it.start } })
                // a link still open continues in the next block
                linkHref?.let { if (sb.length > linkStart) links += RawLink(out.lastIndex, linkStart, sb.length, it) }
                linkStart = 0
            }
            sb.setLength(0)
            spans.clear()
        }

        fun count(n: Int, closing: Boolean) = maxOf(0, n + if (closing) -1 else 1)

        for (match in TAG.findAll(src)) {
            if (skipping == 0) text(src.substring(pos, match.range.first))
            pos = match.range.last + 1
            val name = match.groupValues[2].substringAfter(':').lowercase()
            val closing = match.groupValues[1].isNotEmpty()
            val selfClosing = match.groupValues[3].isNotEmpty()
            when {
                name.isEmpty() -> Unit
                name in m.skip -> if (!selfClosing) skipping = count(skipping, closing)
                skipping > 0 -> Unit
                name == "a" -> when {
                    closing -> linkHref?.let { href ->
                        if (sb.length > linkStart) links += RawLink(out.size, linkStart, sb.length, href)
                        linkHref = null
                    }
                    !selfClosing -> attr(match.value, "href")?.takeUnless { EXTERNAL.containsMatchIn(it) }?.let { linkHref = it; linkStart = sb.length }
                }
                name in m.bold -> if (!selfClosing) bold = count(bold, closing)
                name in m.italic -> if (!selfClosing) italic = count(italic, closing)
                name in m.images -> if (!closing) image(match.value)?.let {
                    flush()
                    out += Block(BlockType.IMAGE, attr(match.value, "alt").orEmpty(), image = it)
                }
                name in m.ctx -> {
                    flush()
                    if (!selfClosing) depth[name] = count(depth[name] ?: 0, closing)
                }
                name in m.breaks -> flush()
            }
            // recorded after the tag's own flush, so an id on a heading points at the heading, not the paragraph before
            if (!closing && skipping == 0) (attr(match.value, "id") ?: if (name == "a") attr(match.value, "name") else null)?.let { anchors.putIfAbsent(it, out.size) }
        }
        if (skipping == 0) text(src.substring(pos))
        flush()
        return Parsed(out, anchors, links)
    }

    // Only common named entities are decoded; unknown ones stay literal.
    private fun decodeEntities(s: String): String = ENTITY.replace(s) { m ->
        val e = m.groupValues[1]
        if (e[0] == '#') {
            runCatching {
                val cp = if (e[1] == 'x' || e[1] == 'X') e.substring(2).toInt(16) else e.substring(1).toInt()
                String(Character.toChars(cp))
            }.getOrDefault(m.value)
        } else NAMED[e] ?: m.value
    }

    fun decode(s: String): String = decodeEntities(s).replace(WS, " ").trim()

    /** Attribute value; also matches namespaced names (xlink:href, l:href). */
    private fun attr(tag: String, name: String): String? =
        Regex("\\s(?:[\\w-]+:)?$name\\s*=\\s*([\"'])(.*?)\\1").find(tag)?.groupValues?.get(2)

    private fun resolve(dir: String, href: String): String {
        val parts = ArrayDeque<String>()
        val path = (if (dir.isEmpty()) "" else "$dir/") + URLDecoder.decode(href.substringBefore('#').replace("+", "%2B"), "UTF-8")
        path.split('/').forEach {
            when (it) {
                "", "." -> Unit
                ".." -> parts.removeLastOrNull()
                else -> parts.addLast(it)
            }
        }
        return parts.joinToString("/")
    }

    private fun xmlText(bytes: ByteArray): String {
        val enc = Regex("encoding\\s*=\\s*[\"']([\\w.-]+)").find(String(bytes, 0, minOf(200, bytes.size), Charsets.ISO_8859_1))?.groupValues?.get(1)
        val charset = enc?.let { runCatching { charset(it) }.getOrNull() } ?: Charsets.UTF_8
        return String(bytes, charset).removePrefix("\uFEFF")
    }

    // Non-UTF-8 text files are read as Windows-1252 (Western languages).
    private fun decodeText(bytes: ByteArray): String = try {
        Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()
    } catch (e: CharacterCodingException) {
        String(bytes, charset("windows-1252"))
    }

    // java.util.Base64 needs API 26 and android.util.Base64 is unavailable in JVM tests, so decode by hand.
    private val B64 = IntArray(128) { -1 }.also { t -> "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".forEachIndexed { i, c -> t[c.code] = i } }

    private fun base64(s: String): ByteArray {
        val out = ByteArrayOutputStream(s.length * 3 / 4)
        var buf = 0
        var bits = 0
        for (c in s) {
            val v = if (c.code < 128) B64[c.code] else -1
            if (v < 0) continue // whitespace and '=' padding
            buf = (buf shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buf shr bits) and 0xFF)
            }
        }
        return out.toByteArray()
    }

    /** Keeps blocks small enough for one translation request: split at sentence ends, hard-split as a last resort. */
    private fun splitLong(b: Block): List<Block> {
        if (b.text.length <= MAX_BLOCK) return listOf(b)
        val pieces = ArrayList<Block>()
        var start = 0
        var prev = 0
        val sentenceStarts = Regex("(?<=[.!?…。！？])\\s+").findAll(b.text).map { it.range.last + 1 } + b.text.length
        for (cut in sentenceStarts) {
            if (cut - start > MAX_BLOCK && prev > start) {
                pieces += slice(b, start, prev)
                start = prev
            }
            prev = cut
        }
        pieces += slice(b, start, b.text.length)
        return pieces.flatMap { p ->
            if (p.text.length <= HARD_MAX_BLOCK) listOf(p)
            else (p.text.indices step HARD_MAX_BLOCK).map { slice(p, it, minOf(it + HARD_MAX_BLOCK, p.text.length)) }
        }
    }

    private fun slice(b: Block, from: Int, to: Int): Block {
        val text = b.text.substring(from, to).trimEnd()
        val end = from + text.length
        val spans = b.spans.mapNotNull { s ->
            if (s.end <= from || s.start >= end) null else s.copy(start = maxOf(s.start, from) - from, end = minOf(s.end, end) - from)
        }
        val links = b.links.mapNotNull { l ->
            if (l.end <= from || l.start >= end) null else l.copy(start = maxOf(l.start, from) - from, end = minOf(l.end, end) - from)
        }
        return b.copy(text = text, spans = spans, links = links)
    }
}

fun sentenceRange(text: String, offset: Int): IntRange {
    if (text.isEmpty()) return 0 until 0
    val o = offset.coerceIn(0, text.length - 1)
    val bi = BreakIterator.getSentenceInstance().apply { setText(text) }
    val start = if (bi.isBoundary(o)) o else bi.preceding(o).coerceAtLeast(0)
    var end = bi.following(o).let { if (it == BreakIterator.DONE) text.length else it }
    while (end > start && text[end - 1].isWhitespace()) end--
    return start until end
}

/** Every sentence of [text], without trailing spaces. */
fun sentenceRanges(text: String): List<IntRange> {
    val bi = BreakIterator.getSentenceInstance().apply { setText(text) }
    val out = ArrayList<IntRange>()
    var start = bi.first()
    var end = bi.next()
    while (end != BreakIterator.DONE) {
        var e = end
        while (e > start && text[e - 1].isWhitespace()) e--
        if (e > start) out += start until e
        start = end
        end = bi.next()
    }
    return out
}

fun sentenceAt(text: String, offset: Int): String = text.substring(sentenceRange(text, offset)).trim().removePrefix("• ")

/** [start, end) of the word under a tapped offset (a tap just after its last letter counts), or null on spaces and punctuation. */
fun wordRange(text: String, offset: Int): IntRange? = wordRangeAt(text, offset) ?: wordRangeAt(text, offset - 1)

fun wordAt(text: String, offset: Int): String? = wordRange(text, offset)?.let { text.substring(it) }

/** The nearest word before [start], to grow a selection into an expression. */
fun previousWord(text: String, start: Int): IntRange? = (start - 1 downTo 0).firstNotNullOfOrNull { i -> wordRangeAt(text, i)?.takeIf { it.last < start } }

/** The nearest word after [end] (exclusive), to grow a selection into an expression. */
fun nextWord(text: String, end: Int): IntRange? = (end until text.length).firstNotNullOfOrNull { i -> wordRangeAt(text, i)?.takeIf { it.first >= end } }

private fun wordRangeAt(text: String, offset: Int): IntRange? {
    if (offset !in text.indices) return null
    val bi = BreakIterator.getWordInstance().apply { setText(text) }
    val start = if (bi.isBoundary(offset)) offset else bi.preceding(offset)
    val end = bi.following(offset)
    if (start == BreakIterator.DONE || end == BreakIterator.DONE) return null
    return (start until end).takeIf { r -> text.substring(r).any { it.isLetter() } }
}
