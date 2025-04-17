from ebooklib import epub, ITEM_DOCUMENT
from bs4 import BeautifulSoup
import sys, os

def flatten_epub(input_path, output_path):
    book = epub.read_epub(input_path)
    all_text_parts = []

    for item in book.get_items():
        if item.get_type() == ITEM_DOCUMENT:
            print(f"🔍 Processing: {item.file_name}")
            soup = BeautifulSoup(item.get_content(), 'html.parser')
            body = soup.find('body') or soup
            all_text_parts.append(str(body))

    if not all_text_parts:
        print("⚠️ No content was found to flatten.")
        return

    full_html = "<html><head><title>Flattened EPUB</title></head><body>"
    full_html += "\n<hr/>\n".join(all_text_parts)
    full_html += "</body></html>"

    new_book = epub.EpubBook()
    new_book.set_identifier('id123456')
    new_book.set_title('Flattened Book')
    new_book.set_language('en')
    new_book.add_author('Unknown')

    chapter = epub.EpubHtml(title='All Content', file_name='chapter.xhtml', lang='en')
    chapter.set_content(full_html)

    new_book.add_item(chapter)
    new_book.toc = (epub.Link('chapter.xhtml', 'All Content', 'all_content'),)
    new_book.spine = ['nav', chapter]
    new_book.add_item(epub.EpubNcx())
    new_book.add_item(epub.EpubNav())

    epub.write_epub(output_path, new_book)
    print(f'✅ Flattened EPUB saved as: {output_path}')

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python flatten_epub.py input.epub output.epub")
        sys.exit(1)

    input_epub = sys.argv[1]
    output_epub = sys.argv[2]

    if not os.path.isfile(input_epub):
        print(f"❌ File not found: {input_epub}")
        sys.exit(1)

    flatten_epub(input_epub, output_epub)
