package com.victor.leitor

import com.victor.leitor.BlockType.HEADING
import com.victor.leitor.BlockType.IMAGE
import com.victor.leitor.BlockType.LIST_ITEM
import com.victor.leitor.BlockType.PARAGRAPH
import com.victor.leitor.BlockType.POEM
import com.victor.leitor.BlockType.QUOTE
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.URLDecoder
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class BookParserTest {
    @Test
    fun htmlBlocksAndInlineStyles() {
        val src = """<html><head><title>X</title><style>p{}</style></head><body>
            <h1>Capítulo 1</h1><p>Ol&#225; &amp; <b>mundo</b>&nbsp;!</p>
            <blockquote><p>cita</p></blockquote><ul><li>um</li></ul><p><em>a</em><br/>b</p><script>x()</script></body></html>"""
        assertEquals(
            listOf(
                Block(HEADING, "Capítulo 1"),
                Block(PARAGRAPH, "Olá & mundo !", listOf(Span(6, 11, bold = true, italic = false))),
                Block(QUOTE, "cita"),
                Block(LIST_ITEM, "um"),
                Block(PARAGRAPH, "a", listOf(Span(0, 1, bold = false, italic = true))),
                Block(PARAGRAPH, "b"),
            ),
            BookParser.html(src),
        )
    }

    @Test
    fun fb2WithLegacyEncodingEmphasisAndImage() {
        val xml = """<?xml version="1.0" encoding="windows-1251"?><FictionBook xmlns:l="http://www.w3.org/1999/xlink">
            <description><title-info><book-title>Livro</book-title><coverpage><image l:href="#pic.png"/></coverpage></title-info></description><body><title><p>Parte 1</p></title>
            <section><p>Привет, <emphasis>мир</emphasis>.</p><image l:href="#pic.png"/>
            <poem><stanza><v>verso um</v><v>verso dois</v></stanza></poem></section>
            </body><binary id="pic.png" content-type="image/png">iVBORw0K
            Ggo=</binary></FictionBook>"""
        val book = BookParser.parse(xml.toByteArray(charset("windows-1251")), "x.fb2")
        assertEquals("Livro", book.title)
        assertEquals(
            listOf(
                Block(HEADING, "Parte 1"),
                Block(PARAGRAPH, "Привет, мир.", listOf(Span(8, 11, bold = false, italic = true))),
                Block(IMAGE, "", image = "0.png"),
                Block(POEM, "verso um"),
                Block(POEM, "verso dois"),
            ),
            book.blocks,
        )
        assertArrayEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A), book.images["0.png"])
        assertArrayEquals("coverpage image is the cover", book.images["0.png"], book.cover)
    }

    @Test
    fun epubSpineOrderAndImages() {
        val cover = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 3)
        val book = BookParser.parse(
            epub(
                "text/ch2.xhtml" to """<html><body><p>segundo</p><img src="../images/cover.jpg" alt="Capa"/></body></html>""",
                "text/ch%201.xhtml" to "<html><body><p>primeiro</p></body></html>",
                images = mapOf("OEBPS/images/cover.jpg" to cover),
            ),
            "livro.epub",
        )
        assertEquals("Meu Livro", book.title)
        assertEquals(listOf(Block(PARAGRAPH, "segundo"), Block(IMAGE, "Capa", image = "0.jpg"), Block(PARAGRAPH, "primeiro")), book.blocks)
        assertArrayEquals(cover, book.images["0.jpg"])
        assertArrayEquals("without a declared cover the first image is used", cover, book.cover)
    }

    @Test
    fun epubDeclaredCoverIsNotARegularImage() {
        val coverBytes = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 9)
        val book = BookParser.parse(
            epub(
                "text/ch.xhtml" to "<p>texto</p>",
                images = mapOf("OEBPS/img/c.jpg" to coverBytes),
                extraManifest = """<item id="cv" href="img/c.jpg" media-type="image/jpeg" properties="cover-image"/>""",
            ),
            "x.epub",
        )
        assertArrayEquals(coverBytes, book.cover)
        assertTrue(book.images.isEmpty())
    }

    @Test
    fun longBlocksSplitAtSentencesKeepingStyles() {
        val html = "<html><body><p>" + "Uma frase de teste bem comum. ".repeat(80) + "<b>Negrito final.</b></p></body></html>"
        val blocks = BookParser.parse(epub("text/ch.xhtml" to html), "x.epub").blocks
        assertTrue(blocks.size > 1)
        assertTrue(blocks.all { it.text.length <= 1500 })
        val last = blocks.last()
        assertEquals(listOf("Negrito final."), last.spans.map { last.text.substring(it.start, it.end) })
        assertTrue(blocks.dropLast(1).all { it.spans.isEmpty() })
    }

    @Test
    fun txtParagraphs() {
        assertEquals(listOf("linha um linha dois", "outro"), BookParser.txt("linha um\nlinha dois\n\noutro\n").map { it.text })
        assertEquals(listOf("a", "b", "c"), BookParser.txt("a\nb\nc").map { it.text })
    }

    @Test
    fun sentenceAroundTap() {
        val text = "It was a bright cold day. The clocks were striking thirteen! She smiled."
        assertEquals("It was a bright cold day.", sentenceAt(text, 10))
        assertEquals("The clocks were striking thirteen!", sentenceAt(text, 30))
        assertEquals("She smiled.", sentenceAt(text, text.length - 2))
    }

    @Test
    fun tappedWord() {
        assertEquals("Olá", wordAt("Olá, mundo!", 1))
        assertEquals("Olá", wordAt("Olá, mundo!", 3)) // tap just after the last letter
        assertEquals("mundo", wordAt("Olá, mundo!", 7))
        assertNull(wordAt("Olá, mundo!", 4))
    }

    @Test
    fun epubLinksAndTocFollowAnchorsInsideAFile() {
        val contents = """<html><body><h1>Contents</h1>
            <p><a href="book.xhtml#ch1">Chapter 1</a></p><p><a href="book.xhtml#ch2">Chapter 2</a></p>
            <p>See <a href="https://example.com">the site</a>.</p></body></html>"""
        val longIntro = "A long sentence about the voyage. ".repeat(60).trim()
        val book = """<html><body><p>$longIntro</p><h2 id="ch1">Chapter 1</h2><p>One.</p>
            <div id="ch2"></div><h2>Chapter 2</h2><p>Two, back to <a href="contents.xhtml">contents</a>.</p></body></html>"""
        val nav = """<html><body><nav epub:type="toc"><ol><li><a href="book.xhtml#ch1">One</a></li>
            <li><a href="book.xhtml#ch2">Two</a></li></ol></nav></body></html>"""
        val parsed = BookParser.parse(
            epub(
                "contents.xhtml" to contents, "book.xhtml" to book,
                images = mapOf("OEBPS/nav.xhtml" to nav.toByteArray()),
                extraManifest = """<item id="nav" href="nav.xhtml" properties="nav"/>""",
            ),
            "x.epub",
        )
        val text = parsed.blocks.map { it.text }
        // the 2000-character intro is split in two, so every target after it moves one block down
        val ch1 = text.lastIndexOf("Chapter 1")
        val ch2 = text.lastIndexOf("Chapter 2")
        assertEquals(listOf(6, 8), listOf(ch1, ch2))
        assertEquals(listOf(Link(0, 9, ch1)), parsed.blocks[1].links)
        assertEquals(listOf(Link(0, 9, ch2)), parsed.blocks[2].links)
        assertEquals("external links are not kept", emptyList<Link>(), parsed.blocks[3].links)
        assertEquals(listOf(Link(13, 21, 0)), parsed.blocks.last().links)
        assertEquals(listOf(TocEntry("One", ch1), TocEntry("Two", ch2)), parsed.toc)
    }

    /** Minimal EPUB: [chapters] (href, html) in spine order; the manifest lists them reversed so order must come from the spine. */
    private fun epub(vararg chapters: Pair<String, String>, images: Map<String, ByteArray> = emptyMap(), extraManifest: String = ""): ByteArray {
        val manifest = chapters.indices.reversed().joinToString("") { """<item id="c$it" href="${chapters[it].first}"/>""" } + extraManifest
        val spine = chapters.indices.joinToString("") { """<itemref idref="c$it"/>""" }
        val files = linkedMapOf(
            "mimetype" to "application/epub+zip".toByteArray(),
            "META-INF/container.xml" to """<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>""".toByteArray(),
            "OEBPS/content.opf" to """<package><metadata><dc:title>Meu Livro</dc:title></metadata>
                <manifest>$manifest</manifest><spine>$spine</spine></package>""".toByteArray(),
        )
        chapters.forEach { (href, html) -> files["OEBPS/" + URLDecoder.decode(href, "UTF-8")] = html.toByteArray() }
        files += images
        return ByteArrayOutputStream().also { out ->
            ZipOutputStream(out).use { z -> files.forEach { (name, body) -> z.putNextEntry(ZipEntry(name)); z.write(body) } }
        }.toByteArray()
    }
}
