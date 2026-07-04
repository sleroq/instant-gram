import App from './App.svelte';
import { mount } from 'svelte';
import '../style.css';

mount(App, { target: document.getElementById('app')! });
