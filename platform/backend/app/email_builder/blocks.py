"""Built-in email blocks — the starting layout.

Each block is one or more <tr> rows inside the single 600px content table that
compose_email() emits. Rows rather than one table per block: it keeps the
composed HTML small, and Gmail clips at ~102KB, so markup weight is a feature
budget, not a style preference.

House rules every block here follows (see platform/EMAIL_HTML.md):
  - nested <table role="presentation">, never div+flex/grid
  - padding on <td>, never margin
  - literal colours via {{token}} placeholders, never CSS variables
  - line-height in px (Word mis-scales unitless values)
  - every <img> carries alt, width, display:block and border:0
  - no border-radius load-bearing anywhere (Outlook squares it)
"""
from __future__ import annotations

from typing import List

# The one place the content width is written down; compose_email reads it too.
W = 600
PAD_X = 32          # side padding inside the card
FONT = "{{font}}"


BUILTIN_BLOCKS: List[dict] = [
    # ---------------------------------------------------------------- logo
    {
        "key": "em-logo-header",
        "name": "Logo header",
        "category": "elements",
        "position": 100,
        "enabled": True,
        "html": (
            f'<tr><td align="center" style="padding:28px {PAD_X}px 20px {PAD_X}px;'
            'background-color:{{card}};">'
            # The logo is a link so the brand mark is clickable, which is what
            # recipients try first. Width attribute AND style: Outlook reads the
            # attribute, everything else reads the style.
            '<a data-em-link="logo_url" href="#" style="text-decoration:none;">'
            '<img data-em-img="logo" src="" alt="{{brand_name}}" width="160" '
            'style="display:block;border:0;outline:none;text-decoration:none;'
            'width:160px;max-width:160px;height:auto;"></a>'
            '</td></tr>'
        ),
        "texts": {"en": {}},
        "assets": {"logo": "token:logo"},
        "names": {"logo": "Brand logo", "logo_url": "Logo link"},
    },

    # ---------------------------------------------------------------- hero
    {
        "key": "em-hero",
        "name": "Hero image",
        "category": "elements",
        "position": 110,
        "enabled": True,
        "html": (
            '<tr><td style="padding:0;background-color:{{card}};">'
            # Edge-to-edge inside the card. width="600" is what Outlook honours;
            # max-width:100% lets every other client scale it down on mobile.
            f'<img data-em-img="hero" src="" alt="" width="{W}" '
            f'style="display:block;border:0;outline:none;width:100%;max-width:{W}px;'
            'height:auto;">'
            '</td></tr>'
        ),
        "texts": {"en": {}},
        "assets": {},
        "names": {"hero": "Hero image"},
    },

    # ------------------------------------------------------------ headline
    {
        "key": "em-headline",
        "name": "Headline",
        "category": "elements",
        "position": 120,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:28px {PAD_X}px 8px {PAD_X}px;'
            'background-color:{{card}};">'
            # A real <h1> for screen readers; every inherited style is restated
            # because clients reset heading margins unpredictably.
            '<h1 data-em-text="headline" style="margin:0;padding:0;'
            f'font-family:{FONT};font-size:28px;line-height:34px;font-weight:700;'
            'color:{{text}};text-align:left;">Your headline goes here</h1>'
            '</td></tr>'
        ),
        "texts": {"en": {"headline": "Your headline goes here"}},
        "assets": {},
        "names": {"headline": "Headline"},
    },

    # ---------------------------------------------------------------- body
    {
        "key": "em-body",
        "name": "Body text",
        "category": "elements",
        "position": 130,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:8px {PAD_X}px 8px {PAD_X}px;'
            'background-color:{{card}};">'
            # 16px/24px: iOS auto-enlarges anything under 13px, and 16 is the
            # smallest size that stays comfortable on a phone.
            '<p data-em-rich="body" style="margin:0;padding:0;'
            f'font-family:{FONT};font-size:16px;line-height:24px;font-weight:400;'
            'color:{{text}};text-align:left;">Write the message here. Keep it to a '
            'few short paragraphs — the goal is the click, not the whole story.</p>'
            '</td></tr>'
        ),
        "texts": {"en": {"body": "Write the message here. Keep it to a few short "
                                 "paragraphs — the goal is the click, not the whole story."}},
        "assets": {},
        "names": {"body": "Body text"},
    },

    # ----------------------------------------------------------------- CTA
    {
        "key": "em-cta",
        "name": "CTA button",
        "category": "elements",
        "position": 140,
        "enabled": True,
        # A "bulletproof" button: a table cell with a background colour and an
        # <a> that fills it. Outlook ignores padding on <a>, which is why the
        # colour and padding live on the <td> and the link merely sits inside.
        "html": (
            f'<tr><td align="left" style="padding:20px {PAD_X}px 28px {PAD_X}px;'
            'background-color:{{card}};">'
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            'style="border-collapse:separate;">'
            '<tr><td align="center" bgcolor="{{cta}}" '
            'style="background-color:{{cta}};border-radius:6px;">'
            '<a data-em-link="cta_url" href="#" '
            'style="display:inline-block;padding:14px 32px;'
            f'font-family:{FONT};font-size:16px;line-height:20px;font-weight:700;'
            'color:{{cta_text}};text-decoration:none;">'
            '<span data-em-text="cta_label">Start now</span></a>'
            '</td></tr></table>'
            '</td></tr>'
        ),
        "texts": {"en": {"cta_label": "Start now"}},
        "assets": {},
        "names": {"cta_label": "Button label", "cta_url": "Button link"},
    },

    # -------------------------------------------------------------- footer
    {
        "key": "em-footer",
        "name": "Compliance footer",
        "category": "elements",
        "position": 900,
        "enabled": True,
        # Everything below is legally load-bearing, not decoration:
        #   risk_warning  — derived from the entity's `regulation` field
        #   address       — CAN-SPAM requires a physical postal address
        #   unsubscribe   — required, and its absence drives spam complaints
        # The compositor fills risk_warning and address from the brand record,
        # so a campaign cannot ship with the wrong regulator's wording.
        "html": (
            f'<tr><td style="padding:24px {PAD_X}px 8px {PAD_X}px;'
            'background-color:{{card}};border-top:1px solid {{border}};">'
            '<p data-em-rich="risk_warning" style="margin:0 0 12px 0;padding:0;'
            f'font-family:{FONT};font-size:11px;line-height:16px;font-weight:400;'
            'color:{{muted}};text-align:left;">Risk warning.</p>'
            '<p data-em-rich="address" style="margin:0 0 12px 0;padding:0;'
            f'font-family:{FONT};font-size:11px;line-height:16px;'
            'color:{{muted}};text-align:left;">Registered address.</p>'
            '<p style="margin:0;padding:0;'
            f'font-family:{FONT};font-size:11px;line-height:16px;'
            'color:{{muted}};text-align:left;">'
            '<a data-em-link="unsubscribe_url" href="{{unsubscribe_url}}" '
            'style="color:{{muted}};text-decoration:underline;">'
            '<span data-em-text="unsubscribe_label">Unsubscribe</span></a>'
            '</p>'
            '</td></tr>'
        ),
        "texts": {"en": {"risk_warning": "Risk warning.",
                         "address": "Registered address.",
                         "unsubscribe_label": "Unsubscribe"}},
        "assets": {},
        "names": {"risk_warning": "Risk warning", "address": "Postal address",
                  "unsubscribe_label": "Unsubscribe text",
                  "unsubscribe_url": "Unsubscribe link"},
    },
]

# The order a new campaign is seeded in — the layout described in the brief:
# logo, hero, headline, body, CTA, footer.
DEFAULT_LAYOUT = ["em-logo-header", "em-hero", "em-headline",
                  "em-body", "em-cta", "em-footer"]
