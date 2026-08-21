import { useEffect, useState } from 'react'
import {
  setTranslationLanguage,
  subscribeTranslationChange,
} from '../i18n'
import type { HomeV2ResolvedLanguage } from './appearance'

/**
 * Keeps Home 2 on the shared Home translation runtime. The language is set
 * during render so children never paint with the previous locale; the
 * subscription supplies the second render when a lazy locale chunk arrives.
 */
export function useHomeV2Translation(
  language: HomeV2ResolvedLanguage,
): number {
  setTranslationLanguage(language)
  const [catalogVersion, setCatalogVersion] = useState(0)
  useEffect(() => {
    const unsubscribe = subscribeTranslationChange(() =>
      setCatalogVersion((version) => version + 1),
    )
    // Close the narrow race where a lazy catalog finishes between render and
    // effect subscription. This extra render also refreshes memoized copy.
    setTranslationLanguage(language)
    setCatalogVersion((version) => version + 1)
    return unsubscribe
  }, [language])
  return catalogVersion
}
