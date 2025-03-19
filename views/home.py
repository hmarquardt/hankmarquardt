import streamlit as st
from pathlib import Path

# Configure page to hide the "Made with Streamlit" footer
st.set_page_config(
    page_title="Hank Marquardt",
    page_icon="🎵",
    layout="wide",
    initial_sidebar_state="auto",
    menu_items={"Report a bug": None, "About": None},
)

# Function to read HTML content from file
def read_html_file(filepath):
    with open(filepath, "r") as f:
        return f.read()

# Path to the HTML file
html_file_path = Path(__file__).parent / "home.html"

# Read and display the HTML content
if html_file_path.exists():
    html_content = read_html_file(html_file_path)
    st.markdown(html_content, unsafe_allow_html=True)
else:
    st.error(f"HTML file not found at {html_file_path}")
