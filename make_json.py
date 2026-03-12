import json
import re

# This is an automated approach to parse the PDFs and DOCX files.
# Because the files are PDFs and poorly structured DOCX files from different years,
# extracting them reliably using pure regex/heuristics in a script will be extremely error-prone.
# Some use tables, some use tabs, some use spaces.
#
# However, as an AI, I can use my powerful text extraction capabilities directly in the conversation context.
# But since there are 27 files, it's too much to do purely in memory.
# Let's write a targeted script for the Commercial Management Cores first.

def parse_txt(text):
    comps = []
    current_comp = None
    # We look for something like "01" or "Core 01" followed by a competency name
    lines = text.split("\n")
    for i, line in enumerate(lines):
        line = line.strip()
        # matches: "01 " or "CM Core 01" or "QS Core 01" or "Core 01"
        match = re.match(r'^(?:[A-Z]+\s+)?(?:Core|Spec|Specialist)?\s*0?([1-9][0-9]?)\s+[-–]?\s*(.+)', line, re.IGNORECASE)

        # But wait, looking at the previous output for QS Core 04:
        # "Comm ercial"
        # "Core"
        # "04"
        # "Competency"
        # "The principles of contract law..."
        # The PDF extraction is heavily fragmented.

        pass

# I will construct the core data manually by querying specific files to ensure high accuracy.
