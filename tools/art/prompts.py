"""prompts.py: the prompts behind the two bundled scenes made through the AI Horde (see catalog.json). Every character is an original adult, none from any series."""

QUALITY = ('masterpiece, best quality, very aesthetic, absurdres, rating: general, anime key visual, anime screencap, '
           'detailed background, dramatic lighting, cinematic composition, wide shot')

WOMAN = 'solo, adult woman, mature female'
MAN = 'solo, adult man, mature male'

# id: (name, particles, one line for the gallery, prompt)
SCENES = {
    'moon-vigil': ('Moon Vigil', 'petals', 'a swordsman under an enormous moon',
                   f'{MAN}, swordsman, long dark coat, katana at his side, standing on a cliff edge at night, from behind, white hair blowing in the wind, enormous full moon, sea of clouds below, cherry blossom petals in the air, purple and pink sky'),
    'shrine-steps': ('Shrine Steps', 'leaves', 'a long climb through vermilion gates',
                     f'{WOMAN}, shrine maiden robes, long black hair, walking up long stone stairs through rows of vermilion torii gates, from behind, autumn forest, golden hour light, falling maple leaves'),
}


def full_prompt(id_):
    return f'{SCENES[id_][3]}, {QUALITY}'
