from pathlib import Path

folders = [
    'app',
    'app/(auth)',
    'app/(tabs)',
    'assets',
    'assets/images',
    'src',
    'src/assets',
    'src/components',
    'src/components/forms',
    'src/components/layout',
    'src/components/ui',
    'src/constants',
    'src/features',
    'src/features/admin',
    'src/features/auth',
    'src/features/auth/api',
    'src/features/auth/components',
    'src/features/auth/hooks',
    'src/features/auth/screens',
    'src/features/auth/types',
    'src/features/booking',
    'src/features/notifications',
    'src/features/profile',
    'src/features/reports',
    'src/hooks',
    'src/services',
    'src/services/api',
    'src/services/firebase',
    'src/store',
    'src/theme',
    'src/types',
    'src/utils',
]

for folder in folders:
    path = Path(folder)
    path.mkdir(parents=True, exist_ok=True)
    gitkeep = path / '.gitkeep'
    if not gitkeep.exists():
        gitkeep.write_text('', encoding='utf-8')
