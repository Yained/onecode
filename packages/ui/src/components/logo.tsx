import { ComponentProps } from "solid-js"
import mark from "../assets/images/onescience-mark.png"
import splash from "../assets/images/onescience-splash.png"
import logo from "../assets/images/onescience-logo.png"

export const Mark = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-mark"
      src={mark}
      alt=""
      draggable={false}
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"img">, "ref" | "class">) => {
  return (
    <img
      ref={props.ref}
      data-component="logo-splash"
      src={splash}
      alt=""
      draggable={false}
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <img
      data-component="logo"
      src={logo}
      alt="OneScience"
      draggable={false}
      classList={{ [props.class ?? ""]: !!props.class }}
    />
  )
}
