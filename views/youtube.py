import time
from datetime import datetime

import feedparser
import streamlit as st

# Configure page to maintain consistent styling
st.set_page_config(
    page_title="YouTube - Earwurmz of Whimsey",
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


def fetch_youtube_feed(channel_feed_url):
    """
    Fetch and parse YouTube channel RSS feed

    Args:
        channel_feed_url: URL of the YouTube channel RSS feed

    Returns:
        Parsed feed data
    """
    feed = feedparser.parse(channel_feed_url)
    return feed


def display_youtube_videos(feed):
    """
    Display YouTube videos from a parsed feed

    Args:
        feed: Parsed feedparser feed object
    """
    if not feed.entries:
        st.warning("No videos found in the feed.")
        return

    st.subheader("Latest YouTube Videos")

    for entry in feed.entries:
        col1, col2 = st.columns([1, 3])

        # Extract video ID from the link
        video_id = entry.yt_videoid
        thumbnail_url = f"https://img.youtube.com/vi/{video_id}/mqdefault.jpg"

        with col1:
            st.image(thumbnail_url, use_container_width=True)

        with col2:
            st.markdown(f"#### [{entry.title}]({entry.link})")

            # Format and display the publication date
            published = datetime.fromtimestamp(time.mktime(entry.published_parsed))
            st.text(f"Published: {published.strftime('%B %d, %Y')}")

            # Display full description
            with st.expander('Video Description'):
                description = entry.summary
                st.text(description)

        st.markdown("---")


# Main page content
st.title("Earwurmz of Whimsey")

channel_feed_url = (
    "https://www.youtube.com/feeds/videos.xml?channel_id=UC_D3lgvy2XWLEZ1Uw4IU9Rg"
)

with st.spinner("Fetching YouTube videos..."):
    feed = fetch_youtube_feed(channel_feed_url)

display_youtube_videos(feed)

# Add a link to the YouTube channel
st.markdown(
    "[YouTube Channel](https://www.youtube.com/channel/UC_D3lgvy2XWLEZ1Uw4IU9Rg)"
)
