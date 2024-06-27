import vikeVue from "vike-vue/config";
import type { Config } from "vike/types";
import Head from "../layouts/HeadDefault.vue";
import Layout from "../layouts/LayoutDefault.vue";

// Default config (can be overridden by pages)
export default {
  Layout,
  Head,
  //# BATI.has("auth0") || BATI.has("firebase-auth") || BATI.has("authjs")
  passToClient: ["user"],
  // <title>
  title: "My Vike App",
  extends: vikeVue,
} satisfies Config;
