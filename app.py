import streamlit as st

# Configure page to hide the "Made with Streamlit" footer
st.set_page_config(
    page_title="Hank Marquardt",
    page_icon="🎵",
    layout="wide",
    initial_sidebar_state="auto",
    menu_items={"Report a bug": None, "About": None},
)

# Hide the Streamlit footer, header, and menu
hide_st_style = """
            <style>
            #MainMenu {visibility: hidden;}
            footer {visibility: hidden;}
            header {visibility: hidden;}
            </style>
            """
st.markdown(hide_st_style, unsafe_allow_html=True)


st.title("Hank Marquardt")

# Main page content
st.write(
    "Welcome to my personal website! Navigate using the sidebar to explore different sections."
)

# You can add more content to the home page here
st.markdown("""
## About Me
I'm a musician and content creator. Check out my YouTube channel in the YouTube section!
""")
