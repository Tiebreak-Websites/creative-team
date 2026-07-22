# For IT — set up Microsoft Entra SSO + MFA for "Creative Builder"

We're putting our internal app **Creative Builder** behind **Microsoft Entra
(Azure AD) SAML SSO**, with **MFA enforced by Conditional Access**. Sign-in is
handled by Supabase (our backend) acting as the SAML Service Provider — you
only configure the Entra side and send one value back.

This is a SECOND, separate Enterprise Application — do not reuse the
CreativeOPS app registration; the two apps have different Service Providers.

**Estimated time:** ~15–20 min. **You need:** Entra admin (Application
Administrator + Conditional Access permissions).

---

## 1. Create the Enterprise Application
Entra admin center → **Enterprise applications** → **New application** →
**Create your own application**.
- Name: `Creative Builder`
- Choose: **Integrate any other application you don't find in the gallery (Non-gallery)**
- Create.

## 2. Configure SAML single sign-on
Open the app → **Single sign-on** → **SAML** → edit **Basic SAML
Configuration** and paste these two values exactly:

| Field | Value |
|-------|-------|
| **Identifier (Entity ID)** | `https://emoznmkqtlujyvzytztm.supabase.co/auth/v1/sso/saml/metadata` |
| **Reply URL (ACS URL)** | `https://emoznmkqtlujyvzytztm.supabase.co/auth/v1/sso/saml/acs` |

(Optional **Sign-on URL**: the app's address once final — not required to work.)
Save.

## 3. Attributes & Claims
**Keep Entra's default claims — no custom claims needed.** Just confirm these
standard ones are present (they're the defaults):
- `…/claims/emailaddress` → `user.mail`
- `…/claims/name` → `user.userprincipalname`
- `…/claims/givenname` → `user.givenname`
- `…/claims/surname` → `user.surname`

We map these to what the app needs on our (Supabase) side — nothing to rename
in Entra.

## 4. Assign who gets access
**Users and groups** → assign the people (or a group) allowed into Creative
Builder. Unassigned users are blocked by Entra before they ever reach the app.

## 5. Require MFA (Conditional Access)
**Conditional Access** → **New policy**:
- **Target / Cloud apps:** select **Creative Builder**
- **Grant:** **Require multifactor authentication**
- Enable the policy.

This is our "MFA login" — no app-side MFA needed.

---

## 6. Send us back ONE thing ⛳
From the app's **Single sign-on → SAML Certificates** section, copy the
**App Federation Metadata URL** (looks like
`https://login.microsoftonline.com/<tenant-id>/federationmetadata/2007-06/federationmetadata.xml?appid=...`).

**Reply with that URL** and we finish the connection on our side.

Also please **confirm the email domain** users will sign in with (we assume
`tiebreak.dev`) — it must match what we register.

---

### FAQ
- **Do you need a redirect/secret/cert from us?** No. The two URLs in §2 are
  all the SP details required; SAML uses certificates exchanged via metadata.
- **Where do passwords live?** Entra. The app stores none.
- **Reference:** Supabase + Azure SAML — https://supabase.com/docs/guides/platform/sso/azure
