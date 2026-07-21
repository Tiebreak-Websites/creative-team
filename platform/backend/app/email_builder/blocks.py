"""Built-in email blocks.

Each block is one or more <tr> rows. `zone` says which of the three stacked
tables compose_email() drops it into:

    header  above the card, on the page background (the logo)
    card    inside the white card (everything you write)
    footer  below the card, on the page background (legal, account links)

Zones exist because a white panel spanning many rows cannot be faked with
per-row backgrounds — it has to be one nested table, and the logo and legal
footer sit outside it.

House rules every block follows (see platform/EMAIL_HTML.md):
  - nested <table role="presentation">, never div+flex/grid
  - padding on <td>, never margin
  - literal colours via {{token}} placeholders, never CSS variables
  - line-height in px (Word mis-scales unitless values)
  - every <img> carries alt, width, display:block and border:0
  - border-radius is decoration only — Outlook squares it and that is fine
"""
from __future__ import annotations

from typing import List

W = 600
PAD_X = 32
FONT = "{{font}}"

# Repeated so often it earns a name.
_P = (f"margin:0;padding:0;font-family:{FONT};font-size:16px;line-height:25px;"
      "font-weight:400;color:{{text}};text-align:left;")


def _cta(label_key: str, url_key: str, label: str) -> str:
    """A bulletproof button: the colour and padding live on the <td> because
    Outlook ignores padding on an <a>, and the link merely fills the cell."""
    return (
        f'<tr><td align="center" style="padding:8px {PAD_X}px 24px {PAD_X}px;'
        'background-color:{{card}};">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="border-collapse:separate;"><tr>'
        '<td align="center" bgcolor="{{cta}}" '
        'style="background-color:{{cta}};border-radius:10px;">'
        f'<a data-em-link="{url_key}" href="#" '
        'style="display:inline-block;min-width:240px;padding:16px 40px;'
        f'font-family:{FONT};font-size:17px;line-height:22px;font-weight:700;'
        'color:{{cta_text}};text-decoration:none;text-align:center;">'
        f'<span data-em-text="{label_key}">{label}</span></a>'
        '</td></tr></table></td></tr>'
    )


BUILTIN_BLOCKS: List[dict] = [
    # ------------------------------------------------------- header zone
    {
        "key": "em-logo-header",
        "name": "Logo header",
        "zone": "header",
        "category": "elements",
        "position": 100,
        "enabled": True,
        "html": (
            f'<tr><td align="center" style="padding:28px {PAD_X}px 24px {PAD_X}px;">'
            '<a data-em-link="logo_url" href="#" style="text-decoration:none;">'
            '<img data-em-img="logo" src="" alt="{{brand_name}}" width="190" '
            'style="display:block;border:0;outline:none;text-decoration:none;'
            'width:190px;max-width:190px;height:auto;"></a>'
            '</td></tr>'
        ),
        "texts": {"en": {}},
        "assets": {"logo": "token:logo"},
        "names": {"logo": "Brand logo", "logo_url": "Logo link"},
    },

    # --------------------------------------------------------- card zone
    {
        "key": "em-headline",
        "name": "Headline",
        "zone": "card",
        "category": "elements",
        "position": 110,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:8px {PAD_X}px 20px {PAD_X}px;'
            'background-color:{{card}};">'
            '<h1 data-em-text="headline" style="margin:0;padding:0;'
            f'font-family:{FONT};font-size:30px;line-height:38px;font-weight:800;'
            'color:{{text}};text-align:center;">Every trader starts somewhere</h1>'
            '</td></tr>'
        ),
        "texts": {"en": {"headline": "Every trader starts somewhere"}},
        "assets": {},
        "names": {"headline": "Headline"},
    },
    {
        "key": "em-cta",
        "name": "CTA button",
        "zone": "card",
        "category": "elements",
        "position": 120,
        "enabled": True,
        "html": _cta("cta_label", "cta_url", "Start learning"),
        "texts": {"en": {"cta_label": "Start learning"}},
        "assets": {},
        "names": {"cta_label": "Button label", "cta_url": "Button link"},
    },
    {
        "key": "em-hero",
        "name": "Hero image",
        "zone": "card",
        "category": "elements",
        "position": 130,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:32px {PAD_X}px 24px {PAD_X}px;'
            'background-color:{{card}};">'
            f'<img data-em-img="hero" src="" alt="" width="{W - PAD_X * 2}" '
            f'style="display:block;border:0;outline:none;width:100%;'
            f'max-width:{W - PAD_X * 2}px;height:auto;border-radius:12px;">'
            '</td></tr>'
        ),
        "texts": {"en": {}},
        "assets": {},
        "names": {"hero": "Hero image"},
    },
    {
        "key": "em-body",
        "name": "Body text",
        "zone": "card",
        "category": "elements",
        "position": 140,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:0 {PAD_X}px 22px {PAD_X}px;'
            'background-color:{{card}};">'
            f'<p data-em-rich="body" style="{_P}">Write the message here. Line breaks '
            'are kept, so you can run a couple of short paragraphs.</p>'
            '</td></tr>'
        ),
        "texts": {"en": {"body": "Write the message here. Line breaks are kept, so you "
                                 "can run a couple of short paragraphs."}},
        "assets": {},
        "names": {"body": "Body text"},
    },
    {
        "key": "em-highlight",
        "name": "Highlight box",
        "zone": "card",
        "category": "elements",
        "position": 150,
        "enabled": True,
        # The tinted callout. A nested table rather than a bordered <div> so the
        # background actually paints in Outlook.
        "html": (
            f'<tr><td style="padding:0 {PAD_X}px 26px {PAD_X}px;'
            'background-color:{{card}};">'
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
            'width="100%" bgcolor="{{tint}}" '
            'style="background-color:{{tint}};border-radius:12px;">'
            '<tr><td style="padding:24px 26px;">'
            '<p data-em-text="highlight_title" style="margin:0 0 14px 0;padding:0;'
            f'font-family:{FONT};font-size:16px;line-height:24px;font-weight:700;'
            'color:{{text}};">But every trader starts somewhere.</p>'
            # The ticks live in the text so they translate and re-order with it.
            '<p data-em-rich="highlight_items" style="margin:0;padding:0;'
            f'font-family:{FONT};font-size:16px;line-height:28px;font-weight:400;'
            'color:{{text}};">✔ No experience.\n✔ No strategy.\n✔ No confidence yet.</p>'
            '</td></tr></table></td></tr>'
        ),
        "texts": {"en": {"highlight_title": "But every trader starts somewhere.",
                         "highlight_items": "✔ No experience.\n✔ No strategy.\n✔ No confidence yet."}},
        "assets": {},
        "names": {"highlight_title": "Box heading", "highlight_items": "Box list"},
    },
    {
        "key": "em-support",
        "name": "Support block",
        "zone": "card",
        "category": "elements",
        "position": 160,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:6px {PAD_X}px 22px {PAD_X}px;'
            'background-color:{{card}};">'
            '<p data-em-text="support_title" style="margin:0 0 6px 0;padding:0;'
            f'font-family:{FONT};font-size:16px;line-height:24px;font-weight:700;'
            'color:{{text}};">Need Assistance?</p>'
            f'<p data-em-rich="support_body" style="{_P}">If you have any issues or '
            'require help, feel free to contact us:</p>'
            '<p style="margin:6px 0 0 0;padding:0;">'
            '<a data-em-link="support_url" href="#" '
            f'style="font-family:{FONT};font-size:16px;line-height:24px;font-weight:700;'
            'color:{{primary}};text-decoration:none;">'
            '<span data-em-text="support_link_label">[CONTACT SUPPORT]</span></a></p>'
            f'<p data-em-rich="support_footer" style="{_P}margin-top:14px;">Our support '
            'team is available to assist you with any concerns.</p>'
            '</td></tr>'
        ),
        "texts": {"en": {"support_title": "Need Assistance?",
                         "support_body": "If you have any issues or require help, feel free to contact us:",
                         "support_link_label": "[CONTACT SUPPORT]",
                         "support_footer": "Our support team is available to assist you with any concerns."}},
        "assets": {},
        "names": {"support_title": "Support heading", "support_body": "Support text",
                  "support_link_label": "Support link text", "support_url": "Support link",
                  "support_footer": "Support closing line"},
    },
    {
        "key": "em-signoff",
        "name": "Sign-off",
        "zone": "card",
        "category": "elements",
        "position": 170,
        "enabled": True,
        "html": (
            f'<tr><td style="padding:0 {PAD_X}px 36px {PAD_X}px;'
            'background-color:{{card}};">'
            f'<p data-em-rich="signoff" style="{_P}">Best regards,\nBrainTrade Team</p>'
            '</td></tr>'
        ),
        "texts": {"en": {"signoff": "Best regards,\nThe team"}},
        "assets": {},
        "names": {"signoff": "Sign-off"},
    },

    # ------------------------------------------------------- footer zone
    {
        "key": "em-footer",
        "name": "Compliance footer",
        "zone": "footer",
        "category": "elements",
        "position": 900,
        "enabled": True,
        # Everything here is legally load-bearing, not decoration:
        #   risk_warning  derived from the entity's `regulation`
        #   legal         operator name, company number, registered address
        #   unsubscribe   required, and its absence drives spam complaints
        "html": (
            f'<tr><td style="padding:22px {PAD_X}px 6px {PAD_X}px;">'
            '<p style="margin:0 0 14px 0;padding:0;'
            f'font-family:{FONT};font-size:13px;line-height:20px;color:{{{{muted}}}};">'
            '<span data-em-text="account_label">Your account:</span> '
            '<a data-em-link="account_url" href="#" '
            'style="color:{{muted}};text-decoration:underline;">'
            '<span data-em-text="account_name">your account</span></a> | '
            '<a data-em-link="password_url" href="#" '
            'style="color:{{muted}};text-decoration:underline;">'
            '<span data-em-text="password_label">Forgot Password</span></a></p>'

            '<p data-em-rich="risk_warning" style="margin:0 0 12px 0;padding:0;'
            f'font-family:{FONT};font-size:12px;line-height:19px;color:{{{{muted}}}};">'
            'Risk warning.</p>'

            '<p data-em-rich="legal" style="margin:0 0 12px 0;padding:0;'
            f'font-family:{FONT};font-size:12px;line-height:19px;color:{{{{muted}}}};">'
            'Operator, company number and registered address.</p>'

            '<p style="margin:0;padding:0 0 24px 0;'
            f'font-family:{FONT};font-size:12px;line-height:19px;color:{{{{muted}}}};">'
            '<a data-em-link="browser_url" href="#" '
            'style="color:{{muted}};text-decoration:underline;">'
            '<span data-em-text="browser_label">View in browser</span></a>'
            ' &nbsp;|&nbsp; '
            '<a data-em-link="unsubscribe_url" href="{{unsubscribe_url}}" '
            'style="color:{{muted}};text-decoration:underline;">'
            '<span data-em-text="unsubscribe_label">Unsubscribe</span></a></p>'
            '</td></tr>'
        ),
        "texts": {"en": {"account_label": "Your account:", "account_name": "your account",
                         "password_label": "Forgot Password",
                         "risk_warning": "Risk warning.",
                         "legal": "Operator, company number and registered address.",
                         "browser_label": "View in browser",
                         "unsubscribe_label": "Unsubscribe"}},
        "assets": {},
        "names": {"account_label": "Account line", "account_name": "Account link text",
                  "account_url": "Account link", "password_label": "Password link text",
                  "password_url": "Password link", "risk_warning": "Risk warning",
                  "legal": "Legal / operator", "browser_label": "View-in-browser text",
                  "browser_url": "View-in-browser link",
                  "unsubscribe_label": "Unsubscribe text", "unsubscribe_url": "Unsubscribe link"},
    },
]

# The order a new campaign is seeded in: logo, hero, headline, CTA, body,
# highlight, body, CTA, support, sign-off, footer. Blocks
# repeat by design; each placement is its own instance with its own text.
DEFAULT_LAYOUT = [
    "em-logo-header",
    "em-hero",
    "em-headline",
    "em-cta",
    "em-body",
    "em-highlight",
    "em-body",
    "em-cta",
    "em-support",
    "em-signoff",
    "em-footer",
]
