import re

path = "E:/AI-Sidebar/sidebar/sidebar.js"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

def decode_unicode(m):
    return chr(int(m.group(1), 16))

# Match literal backslash-u followed by 4 hex digits
# Handle surrogate pairs: decode \uD800-\uDFFF \uDC00-\uDFFF as one char
def fix_all(text):
    pattern = r"\\u([0-9a-fA-F]{4})"
    # Pass 1: merge surrogate pairs
    # Find all \uXXXX patterns
    segments = []
    last_end = 0
    for match in re.finditer(pattern, text):
        start, end = match.span()
        segments.append((start, end, match.group(1)))

    if not segments:
        return text

    # Merge adjacent surrogates (high + low)
    i = 0
    result = []
    pos = 0
    while i < len(segments):
        start, end, hexval = segments[i]
        codepoint = int(hexval, 16)

        # Check if this is a high surrogate and next is a low surrogate
        if 0xD800 <= codepoint <= 0xDBFF and i + 1 < len(segments):
            next_start, next_end, next_hex = segments[i + 1]
            next_cp = int(next_hex, 16)
            if 0xDC00 <= next_cp <= 0xDFFF and next_start == end:
                # Valid surrogate pair - decode as single character
                combined = chr(codepoint) + chr(next_cp)
                # Python 3: use surrogatepass or just encode directly
                try:
                    char = chr(0x10000 + (codepoint - 0xD800) * 0x400 + (next_cp - 0xDC00))
                    result.append(text[pos:start])
                    result.append(char)
                    pos = next_end
                    i += 2
                    continue
                except:
                    pass

        # Single character
        result.append(text[pos:start])
        try:
            result.append(chr(codepoint))
        except:
            result.append(text[start:end])  # keep original if invalid
        pos = end
        i += 1

    result.append(text[pos:])
    return "".join(result)

fixed = fix_all(content)

with open(path, "w", encoding="utf-8") as f:
    f.write(fixed)

# Count
count = len(re.findall(r"\\u([0-9a-fA-F]{4})", content))
print(f"Fixed {count} Unicode escapes")