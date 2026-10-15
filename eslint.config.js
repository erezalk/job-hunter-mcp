import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['bundle/server/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { 'no-console': 'error' } },
)
