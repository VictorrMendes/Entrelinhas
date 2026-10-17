"""
Turns the source art in assets/ (JPG/PNG, names with accents and spaces) into
the app's drawables: 512 px WebP named the way Android requires. Run it again
after replacing an image:

    python -I android/scripts/import_art.py

Needs Pillow (pip install pillow).
"""
import os

from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SRC = os.path.join(ROOT, "assets", "conquistas")
OUT = os.path.join(ROOT, "android", "app", "src", "main", "res",
                   "drawable-nodpi")
SIZE = 512

# drawable: source under assets/conquistas/
ART = {
    "ach_first_goal": "Ofensiva/Primeira meta — canto lower-left.jpg",
    "ach_streak_3": "Ofensiva/Pegou o ritmo — 3 dias de sequência.jpg",
    "ach_week_streak": "Ofensiva/Uma semana firme.jpg",
    "ach_month_streak": "Ofensiva/Hábito de leitura.jpg",
    "ach_streak_100": "Ofensiva/Centenário.jpg",
    "ach_weeks_4": "Ofensiva/Quatro semanas.jpg",
    "ach_weeks_12": "Ofensiva/Trimestre firme.jpg",
    "ach_words_50": "Vocabulário/Colecionador.jpg",
    "ach_words_250": "Vocabulário/Dicionário vivo.jpg",
    "ach_learned_25": "Vocabulário/Memória afiada.jpg",
    "ach_learned_100": "Vocabulário/Vocabulário de ferro.jpg",
    "ach_dictations": "Vocabulário/Ouvido treinado.jpg",
    "ach_first_book": "Leitura/Fim!.jpg",
    "ach_five_books": "Leitura/Devorador de livros.jpg",
    "ach_ten_hours": "Leitura/Maratonista.jpg",
    "ach_fifty_hours": "Leitura/Leitor de fôlego.jpg",
}

os.makedirs(OUT, exist_ok=True)
for name, src in ART.items():
    im = Image.open(os.path.join(SRC, src)).convert("RGB")
    out = os.path.join(OUT, f"{name}.webp")
    ImageOps.fit(im, (SIZE, SIZE), Image.LANCZOS).save(
        out, "WEBP", quality=80, method=6)
    print(f"{name}.webp  {os.path.getsize(out) // 1024} KB")
