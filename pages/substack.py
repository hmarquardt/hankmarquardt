import time
from datetime import datetime

import feedparser
import streamlit as st

# Configure page to maintain consistent styling
st.set_page_config(
    page_title="Substack - Hank Marquardt",
    page_icon="📰",
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


def fetch_substack_feed(feed_url):
    """
    Fetch and parse Substack RSS feed

    Args:
        feed_url: URL of the Substack RSS feed

    Returns:
        Parsed feed data
    """
    feed = feedparser.parse(feed_url)
    return feed


def display_substack_posts(feed):
    """
    Display Substack posts from a parsed feed

    Args:
        feed: Parsed feedparser feed object
    """
    if not feed.entries:
        st.warning("No posts found in the feed.")
        return

    st.subheader("Latest Substack Posts")

    for entry in feed.entries:
        st.markdown(f"#### [{entry.title}]({entry.link})")

        # Format and display the publication date
        published = datetime.fromtimestamp(time.mktime(entry.published_parsed))
        st.text(f"Published: {published.strftime('%B %d, %Y')}")

        # Display full description
        description = entry.summary
        st.markdown(description, unsafe_allow_html=True)

        st.markdown("---")


# Main page content
st.title("Hank Marquardt's Substack")

substack_feed_url = "https://hankmarquardt.substack.com/feed"

with st.spinner("Fetching Substack posts..."):
    feed = fetch_substack_feed(substack_feed_url)
    
display_substack_posts(feed)

