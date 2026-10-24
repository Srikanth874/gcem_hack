"use client"

interface AnimatedTextProps {
  text: string
  delay?: number
}

export function AnimatedText({ text, delay = 0 }: AnimatedTextProps) {
  return (
    <span key={text} aria-label={text}>
      {text.split("").map((char, index) => (
        <span
          key={`${text}-${index}`}
          className="inline-block animate-text-in"
          style={{
            animationDelay: `${delay + index * 0.03}s`,
          }}
          aria-hidden="true"
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </span>
  )
}
