import React, { useEffect, useMemo, useState } from "react"

declare global {
  interface Window {
    mermaid?: {
      initialize: (config: Record<string, unknown>) => void
      render: (id: string, code: string) => Promise<{ svg: string }>
    }
  }
}

const MERMAID_SCRIPT_ID = "mermaid-cdn-script"
const MERMAID_CDN_SRC =
  "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"
let mermaidLoaderPromise: Promise<void> | null = null

const ensureMermaidLoaded = (): Promise<void> => {
  if (window.mermaid) return Promise.resolve()
  if (mermaidLoaderPromise) return mermaidLoaderPromise

  mermaidLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(MERMAID_SCRIPT_ID) as
      | HTMLScriptElement
      | null

    if (existingScript) {
      if (window.mermaid) {
        resolve()
        return
      }
      if (existingScript.getAttribute("data-loaded") === "true") {
        reject(new Error("Mermaid script loaded but runtime unavailable."))
        return
      }
      existingScript.addEventListener("load", () => resolve(), { once: true })
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Failed to load Mermaid script.")),
        { once: true }
      )
      return
    }

    const script = document.createElement("script")
    script.id = MERMAID_SCRIPT_ID
    script.src = MERMAID_CDN_SRC
    script.async = true
    script.onload = () => {
      script.setAttribute("data-loaded", "true")
      resolve()
    }
    script.onerror = () => reject(new Error("Failed to load Mermaid script."))
    document.head.appendChild(script)
  })

  return mermaidLoaderPromise
}

const extractMermaidDefinition = (diagram: string): string => {
  const fenced = diagram.match(/```mermaid\s*([\s\S]*?)```/i)
  if (fenced && fenced[1]) {
    return fenced[1].trim()
  }
  return diagram.trim()
}

interface MermaidDiagramProps {
  title: string
  diagram: string | null
  isLoading: boolean
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
  title,
  diagram,
  isLoading
}) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const diagramDefinition = useMemo(
    () => (diagram ? extractMermaidDefinition(diagram) : ""),
    [diagram]
  )
  const diagramId = useMemo(
    () => `mermaid-${title.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    [title, diagramDefinition]
  )

  useEffect(() => {
    let canceled = false

    const renderDiagram = async () => {
      if (!diagramDefinition) {
        setSvg(null)
        return
      }

      try {
        setError(null)
        await ensureMermaidLoaded()
        if (!window.mermaid) {
          throw new Error("Mermaid runtime unavailable.")
        }

        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "dark",
          flowchart: { curve: "basis" }
        })

        const result = await window.mermaid.render(diagramId, diagramDefinition)
        if (!canceled) {
          setSvg(result.svg)
        }
      } catch (err) {
        if (!canceled) {
          setSvg(null)
          setError((err as Error).message || "Failed to render diagram.")
        }
      }
    }

    renderDiagram()
    return () => {
      canceled = true
    }
  }, [diagramDefinition, diagramId])

  return (
    <div className="space-y-2">
      <h2 className="text-[13px] font-medium text-white tracking-wide">
        {title}
      </h2>
      {isLoading ? (
        <p className="text-xs bg-gradient-to-r from-gray-300 via-gray-100 to-gray-300 bg-clip-text text-transparent animate-pulse">
          Rendering diagram...
        </p>
      ) : (
        <div className="bg-white/5 rounded-md p-3 overflow-auto">
          {svg ? (
            <div
              className="min-w-[560px]"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <pre className="text-[12px] leading-5 text-gray-200 whitespace-pre-wrap">
              {error ? `${error}\n\n${diagramDefinition}` : diagramDefinition}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default MermaidDiagram
